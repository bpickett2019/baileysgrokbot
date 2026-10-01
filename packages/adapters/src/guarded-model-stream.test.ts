import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { ModelCallGuard } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { guardedModelStream, promptTextSize } from "./guarded-model-stream.js";
import { reliableModelStream } from "./pi-runtime.js";

const model: Model<"anthropic-messages"> = {
  id: "fixture",
  name: "Fixture",
  provider: "fixture",
  api: "anthropic-messages",
  baseUrl: "https://fixture.example",
  reasoning: false,
  input: ["text", "image"],
  contextWindow: 10_000,
  maxTokens: 1000,
  cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};
const message: AssistantMessage = {
  role: "assistant",
  api: model.api,
  provider: model.provider,
  model: model.id,
  content: [{ type: "text", text: "done" }],
  stopReason: "stop",
  timestamp: 1,
  usage: {
    input: 100,
    cacheRead: 600,
    cacheWrite: 300,
    output: 10,
    totalTokens: 1010,
    cost: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 },
  },
};
const context = { messages: [], systemPrompt: "Fixture" };
function transport() {
  const stream = new AssistantMessageEventStream();
  stream.push({ type: "done", reason: "stop", message });
  stream.end();
  return stream;
}

describe("pre-dispatch model accounting", () => {
  it("does not start transport until reservation commits; settles before delivering the final message", async () => {
    const settled = vi.fn().mockResolvedValue(undefined);
    let commit!: (value: { settle: typeof settled }) => void;
    const guard: ModelCallGuard = {
      maxPromptChars: 1000,
      reserve: vi.fn(
        () =>
          new Promise<{ settle: typeof settled }>((resolve) => {
            commit = resolve;
          }),
      ),
    };
    const start = vi.fn(transport);
    const stream = guardedModelStream(guard, model, context, 100, undefined, start);
    expect(start).not.toHaveBeenCalled();
    commit({ settle: settled });
    const result = await stream.result();
    expect(result.stopReason).toBe("stop");
    expect(settled).toHaveBeenCalledWith({
      inputTokens: 1000,
      outputTokens: 10,
      cacheReadTokens: 600,
      cacheWriteTokens: 300,
    });
    expect(guard.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ maxInputTokens: 10_000, maxOutputTokens: 100 }),
    );
  });
  it("never sends an over-budget request", async () => {
    const start = vi.fn(transport);
    const guard: ModelCallGuard = {
      maxPromptChars: 1000,
      reserve: vi.fn().mockRejectedValue(new Error("Budget exhausted")),
    };
    const result = await guardedModelStream(guard, model, context, 100, undefined, start).result();
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("Budget exhausted");
    expect(start).not.toHaveBeenCalled();
  });
  it("stops oversized contexts before reserving or dispatching", async () => {
    const reserve = vi.fn();
    const start = vi.fn(transport);
    const result = await guardedModelStream(
      { maxPromptChars: 5, reserve },
      model,
      context,
      100,
      undefined,
      start,
    ).result();
    expect(result.errorMessage).toContain("context limit");
    expect(reserve).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
  it("retains uncertain transport usage instead of refunding or replaying", async () => {
    const settle = vi.fn().mockResolvedValue(undefined);
    const start = vi.fn(() => {
      throw new Error("Connection lost");
    });
    const stream = guardedModelStream(
      { maxPromptChars: 1000, reserve: async () => ({ settle }) },
      model,
      context,
      100,
      undefined,
      start,
    );
    expect((await stream.result()).stopReason).toBe("error");
    expect(settle).toHaveBeenCalledWith(null);
    expect(start).toHaveBeenCalledOnce();
  });
  it("retains reservations when the provider reports an error", async () => {
    const settle = vi.fn().mockResolvedValue(undefined);
    const start = () => {
      const stream = new AssistantMessageEventStream();
      stream.push({ type: "error", reason: "error", error: { ...message, stopReason: "error" } });
      stream.end();
      return stream;
    };
    await guardedModelStream(
      { maxPromptChars: 1000, reserve: async () => ({ settle }) },
      model,
      context,
      100,
      undefined,
      start,
    ).result();
    expect(settle).toHaveBeenCalledWith(null);
  });
  it("retains the reservation when a successful response omits usable token counts", async () => {
    const settle = vi.fn().mockResolvedValue(undefined);
    const start = () => {
      const stream = new AssistantMessageEventStream();
      stream.push({
        type: "done",
        reason: "stop",
        message: {
          ...message,
          usage: {
            ...message.usage,
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
          },
        },
      });
      stream.end();
      return stream;
    };
    await guardedModelStream(
      { maxPromptChars: 1000, reserve: async () => ({ settle }) },
      model,
      context,
      100,
      undefined,
      start,
    ).result();
    expect(settle).toHaveBeenCalledWith(null);
  });

  it("guards the actual Pi transport wrapper and disables hidden provider retries", async () => {
    const models = builtinModels();
    const start = vi.spyOn(models, "streamSimple").mockImplementation(transport);
    const settle = vi.fn().mockResolvedValue(undefined);
    const reserve = vi.fn().mockResolvedValue({ settle });
    try {
      const result = await reliableModelStream(
        models,
        model,
        context,
        { maxRetries: 4 },
        100,
        "fixture-key",
        { maxPromptChars: 1000, reserve },
      ).result();
      expect(result.stopReason).toBe("stop");
      expect(start).toHaveBeenCalledOnce();
      expect(start.mock.calls[0]?.[2]).toMatchObject({ maxRetries: 0, maxTokens: 100 });
      expect(settle).toHaveBeenCalledOnce();
    } finally {
      start.mockRestore();
    }
  });

  it("does not shrink reservations to a locally overridden context window", async () => {
    const models = builtinModels();
    const catalog = models.getModel("anthropic", "claude-opus-5-5")!;
    const start = vi.spyOn(models, "streamSimple").mockImplementation(transport);
    const reserve = vi.fn().mockResolvedValue({ settle: async () => {} });
    try {
      await reliableModelStream(
        models,
        { ...catalog, contextWindow: 1024 },
        context,
        undefined,
        4096,
        "fixture-key",
        { maxPromptChars: 1000, reserve },
      ).result();
      expect(reserve).toHaveBeenCalledWith(
        expect.objectContaining({ maxInputTokens: catalog.contextWindow }),
      );
    } finally {
      start.mockRestore();
    }
  });

  it("stops a fourth screenshot before any paid dispatch", async () => {
    const reserve = vi.fn();
    const start = vi.fn(transport);
    const messages = [
      {
        role: "user" as const,
        timestamp: 1,
        content: Array.from({ length: 4 }, () => ({
          type: "image" as const,
          data: "fixture",
          mimeType: "image/png",
        })),
      },
    ];
    expect(
      (
        await guardedModelStream(
          { maxPromptChars: 1000, reserve },
          model,
          { messages },
          100,
          undefined,
          start,
        ).result()
      ).stopReason,
    ).toBe("error");
    expect(reserve).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("counts image placeholders rather than base64 bytes as prompt text", () => {
    expect(
      promptTextSize({
        messages: [
          {
            role: "user",
            timestamp: 1,
            content: [{ type: "image", data: "x".repeat(1_000_000), mimeType: "image/png" }],
          },
        ],
      }),
    ).toBeLessThan(200);
  });
});
