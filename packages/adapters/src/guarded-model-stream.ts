import type { Api, AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { ModelCallGuard } from "@rakazo/adapter-kit";
import { billedPromptTokens } from "./pi-runtime-limits.js";

function promptFootprint(context: Context) {
  let images = 0;
  const chars = JSON.stringify(context, (_key, value) => {
    if (value && typeof value === "object" && value.type === "image") {
      images++;
      return { type: "image" };
    }
    return value;
  }).length;
  return { chars, images };
}
export function promptTextSize(context: Context): number {
  return promptFootprint(context).chars;
}

/** Wait for a durable reservation before starting transport. Never auto-retry an uncertain call. */
export function guardedModelStream(
  guard: ModelCallGuard,
  model: Model<Api>,
  context: Context,
  maxOutputTokens: number,
  signal: AbortSignal | undefined,
  start: () => AssistantMessageEventStream,
): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  void (async () => {
    let reservation: Awaited<ReturnType<ModelCallGuard["reserve"]>> | undefined;
    let settled = false;
    let dispatched = false;
    const settle = async (usage: Parameters<NonNullable<typeof reservation>["settle"]>[0]) => {
      if (!reservation || settled) return;
      await reservation.settle(usage);
      settled = true;
    };
    try {
      signal?.throwIfAborted();
      const footprint = promptFootprint(context);
      if (footprint.chars > guard.maxPromptChars || footprint.images > 3)
        throw new Error(
          "Work-package context limit reached. Split/review this package; no model request was sent.",
        );
      reservation = await guard.reserve({
        provider: model.provider,
        model: model.id,
        maxInputTokens: model.contextWindow,
        maxOutputTokens,
        rates: model.cost,
      });
      signal?.throwIfAborted();
      dispatched = true;
      const inner = start();
      let terminal = false;
      for await (const event of inner) {
        if (event.type === "done" || event.type === "error") {
          terminal = true;
          const usage = event.type === "done" ? billedPromptTokens(event.message.usage) : null;
          // SDK streams initialize usage to zero even when a provider omits final usage.
          // A dispatched zero-usage response is not proof that the request was free.
          await settle(usage && usage.inputTokens + usage.outputTokens > 0 ? usage : null);
        }
        stream.push(event);
      }
      if (!terminal) throw new Error("Model stream ended without final usage.");
    } catch (error) {
      try {
        await settle(
          dispatched
            ? null
            : { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        );
      } catch {
        // A failed settlement retains the reservation in the database. Never refund on timeout.
      }
      const message: AssistantMessage = {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        stopReason: "error",
        errorMessage: error instanceof Error ? error.message : "Build model request stopped.",
        timestamp: Date.now(),
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      stream.push({ type: "error", reason: "error", error: message });
    } finally {
      stream.end();
    }
  })();
  return stream;
}
