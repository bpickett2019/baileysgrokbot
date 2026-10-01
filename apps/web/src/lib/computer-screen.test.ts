import type { ProductEvent } from "@rakazo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computerScreenInvalidated,
  embeddableScreenUrl,
  loadComputerScreen,
  screenIframeSandbox,
} from "./computer-screen";

function screenEvent(type: ProductEvent["type"], botId = "displayed-bot"): ProductEvent {
  return {
    id: "event-id",
    spaceId: "space-id",
    threadId: "thread-id",
    botId,
    seq: 1,
    type,
    payload: {},
    runId: "run-id",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("computer screen authorization refresh", () => {
  it.each([
    "run.started",
    "run.completed",
    "run.cancelled",
    "run.failed",
    "run.waiting_input",
    "computer.status",
    "computer.takeover.requested",
    "computer.takeover.granted",
    "computer.takeover.released",
  ] as const)("refreshes the displayed bot for %s, but not a different group member", (type) => {
    expect(computerScreenInvalidated(screenEvent(type), "displayed-bot")).toBe(true);
    expect(computerScreenInvalidated(screenEvent(type, "other-bot"), "displayed-bot")).toBe(false);
    expect(computerScreenInvalidated(screenEvent(type))).toBe(false);
  });

  it.each([
    "thread.progress",
    "agent.tool.completed",
    "thread.message.created",
    "bot.updated",
  ] as const)("does not rotate the screen on ordinary %s activity", (type) => {
    expect(computerScreenInvalidated(screenEvent(type), "displayed-bot")).toBe(false);
  });
});

describe("computer screen requests", () => {
  it("shows connection failures and lets a successful retry clear them", async () => {
    const commit = vi.fn();
    const options = {
      isCurrent: () => true,
      commit,
      fallbackError: "Could not connect",
    };
    await loadComputerScreen({
      ...options,
      load: async () => {
        throw new Error("Control stream failed to start");
      },
    });
    expect(commit).toHaveBeenLastCalledWith({
      url: null,
      error: "Control stream failed to start",
    });

    await expect(
      loadComputerScreen({
        ...options,
        load: async () => ({ url: "https://screen.example/vnc.html" }),
      }),
    ).resolves.toBe("https://screen.example/vnc.html");
    expect(commit).toHaveBeenLastCalledWith({
      url: "https://screen.example/vnc.html",
      error: null,
    });
  });

  it.each(["success", "failure"])(
    "ignores a stale %s after a newer screen failure",
    async (outcome) => {
      let finish!: (screen: { url: string | null }) => void;
      let fail!: (error: Error) => void;
      const deferred = new Promise<{ url: string | null }>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      let current = 1;
      const commit = vi.fn();
      const stale = loadComputerScreen({
        load: () => deferred,
        isCurrent: () => current === 1,
        commit,
        fallbackError: "Could not connect",
      });
      current = 2;
      await loadComputerScreen({
        load: async () => {
          throw new Error("Latest connection failed");
        },
        isCurrent: () => current === 2,
        commit,
        fallbackError: "Could not connect",
      });
      if (outcome === "success") finish({ url: "https://stale.example/vnc.html" });
      else fail(new Error("Stale connection failed"));
      await expect(stale).resolves.toBeNull();
      expect(commit).toHaveBeenCalledExactlyOnceWith({
        url: null,
        error: "Latest connection failed",
      });
    },
  );

  it("uses the visible fallback for errors without a message", async () => {
    const commit = vi.fn();
    await loadComputerScreen({
      load: async () => Promise.reject(null),
      isCurrent: () => true,
      commit,
      fallbackError: "Could not connect",
    });
    expect(commit).toHaveBeenCalledExactlyOnceWith({ url: null, error: "Could not connect" });
  });
});

describe("embeddableScreenUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides a local screen whose port does not match the page", () => {
    vi.stubGlobal("window", { location: { href: "http://localhost:5173/" } });
    expect(embeddableScreenUrl("http://127.0.0.1:6080/vnc.html")).toBeNull();
    expect(embeddableScreenUrl("http://localhost:6080/vnc.html")).toBeNull();
  });

  it("keeps a non-local screen even when the port differs", () => {
    vi.stubGlobal("window", { location: { href: "http://localhost:5173/" } });
    expect(embeddableScreenUrl("https://screen.example:6080/vnc.html")).toBe(
      "https://screen.example:6080/vnc.html",
    );
  });
});

describe("screenIframeSandbox", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows scripts and pointer lock only for /novnc/ paths", () => {
    vi.stubGlobal("window", { location: { href: "http://localhost:5173/" } });
    expect(screenIframeSandbox("http://127.0.0.1:5173/novnc/vnc.html")).toBe(
      "allow-scripts allow-pointer-lock",
    );
    expect(screenIframeSandbox("http://127.0.0.1:5173/vnc.html")).toBeUndefined();
  });
});
