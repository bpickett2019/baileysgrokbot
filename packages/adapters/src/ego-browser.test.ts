import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AdapterContext, ComputerRef } from "@rakazo/adapter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserProvider } from "./browser-provider-factory.js";
import { browserActFromTool, browserNavigateFromTool } from "./browser-tools.js";
import type { BrowserConnection, EgoCommand, EgoDriver } from "./ego-browser.js";
import { EgoBrowserProvider } from "./ego-browser.js";
import { EGO_BROWSER_PROGRAM } from "./ego-browser-program.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const context: AdapterContext = {
  operationId: "op",
  traceId: "trace",
  userId: "user",
  spaceId: "space",
  botId: "bot",
  runId: "run",
  signal: new AbortController().signal,
};
const computer: ComputerRef = {
  id: "container",
  providerRef: "container",
  botId: "team-home",
  kind: "docker",
};
const connection: BrowserConnection = {
  provider: "ego",
  userId: "user",
  spaceId: "space",
  computerHomeKey: "team-home",
  botIds: ["bot", "specialist"],
  taskSpaceId: 7,
  page: "p1",
  allowedOrigins: ["https://example.test"],
};
function result(input?: EgoCommand) {
  return {
    ok: true,
    completed: input?.command === "act" ? input.actions.length : 0,
    uncertain: false,
    page: "p1",
    url: "https://example.test/form",
    title: "Signup",
    tree: 'textbox "Email" [e1]\nbutton "Continue" [e2]',
    elements: [
      { ref: "e1", role: "textbox", name: "Email" },
      { ref: "e2", role: "button", name: "Continue" },
    ],
  };
}
async function fixture(driver: EgoDriver = async (input) => result(input)) {
  const dir = await mkdtemp(path.join(tmpdir(), "rakazo-ego-test-"));
  directories.push(dir);
  const file = path.join(dir, "connection.json");
  await writeFile(file, JSON.stringify(connection), { mode: 0o600 });
  return { provider: new EgoBrowserProvider(file, driver), file };
}
const actions = [
  { kind: "fill" as const, ref: "e1", text: "example" },
  { kind: "click" as const, ref: "e2" },
];

describe("Ego browser provider (offline)", () => {
  it("conforms to navigation, observation and batched actions without a desktop fallback", async () => {
    const driver = vi.fn(async (input: EgoCommand) => result(input));
    const { provider } = await fixture(driver);
    expect(provider.describe()).toMatchObject({
      contractVersion: "1",
      capabilities: { page: true, refs: true, keyless: true, computerDesktop: false },
    });
    expect(
      await provider.navigate(computer, { url: "https://example.test/form" }, context),
    ).toMatchObject({ title: "Signup" });
    expect((await provider.snapshot(computer, {}, context)).elements).toHaveLength(2);
    const completed = await provider.act(computer, { actions }, context);
    expect(completed).toMatchObject({ ok: true, completed: 2 });
    expect(completed.fallback).toBeUndefined();
    expect(driver.mock.calls.at(-1)?.[0]).toMatchObject({
      command: "act",
      taskSpaceId: 7,
      page: "p1",
      actions,
    });
  });
  it.each([{ userId: "other" }, { spaceId: "other" }, { botId: "other" }])(
    "rejects a foreign caller %j before launching the CLI",
    async (scope) => {
      const driver = vi.fn();
      const { provider } = await fixture(driver);
      expect(await provider.snapshot(computer, {}, { ...context, ...scope })).toMatchObject({
        error: expect.stringContaining("not authorized"),
      });
      expect(driver).not.toHaveBeenCalled();
    },
  );
  it("rejects a foreign computer and accepts the same home after container replacement", async () => {
    const driver = vi.fn(async (input: EgoCommand) => result(input));
    const { provider } = await fixture(driver);
    expect(
      await provider.snapshot({ ...computer, botId: "other-home" }, {}, context),
    ).toMatchObject({ error: expect.stringContaining("not authorized") });
    expect(driver).not.toHaveBeenCalled();
    expect(await provider.snapshot({ ...computer, id: "replacement" }, {}, context)).toMatchObject({
      title: "Signup",
    });
  });
  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://evil.test/",
    "https://user:pass@example.test/",
  ])("blocks unconfigured navigation %s", async (url) => {
    const driver = vi.fn();
    const { provider } = await fixture(driver);
    const response = await browserNavigateFromTool(provider, computer, context, { url });
    expect(response.error).toBeTruthy();
    expect(response.fallback).toBeUndefined();
    expect(driver).not.toHaveBeenCalled();
  });
  it("requires this run's observed refs and never treats selectors as executable code", async () => {
    const driver = vi.fn(async (input: EgoCommand) => result(input));
    const { provider } = await fixture(driver);
    expect(await provider.act(computer, { actions }, context)).toMatchObject({ ok: false });
    expect(driver).not.toHaveBeenCalled();
    await provider.snapshot(computer, {}, context);
    expect(
      await provider.act(
        computer,
        { actions: [{ kind: "click", ref: '";process.exit()' }] },
        context,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await provider.act(computer, { actions: [{ kind: "click", ref: "e999" }] }, context),
    ).toMatchObject({ ok: false });
    expect(
      await provider.act(computer, { actions }, { ...context, runId: "new-run" }),
    ).toMatchObject({ ok: false });
    expect(
      await provider.act(computer, { actions }, { ...context, botId: "specialist" }),
    ).toMatchObject({ ok: false });
    expect(driver).toHaveBeenCalledTimes(1);
  });
  it("does not pass saved credentials to the CLI", async () => {
    const driver = vi.fn(async (input: EgoCommand) => result(input));
    const { provider } = await fixture(driver);
    await provider.snapshot(computer, {}, context);
    expect(
      await provider.act(
        computer,
        { actions: [{ kind: "fill", ref: "e1", text: "secret", origin: "https://example.test" }] },
        context,
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("sign in directly") });
    expect(driver).toHaveBeenCalledTimes(1);
    const invalid = await browserActFromTool(provider, computer, context, {
      actions: [{ kind: "eval", ref: "e1" }],
    });
    expect(invalid).not.toHaveProperty("fallback");
  });
  it("serializes access across provider instances", async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { provider, file } = await fixture(async (input) => {
      entered();
      await waiting;
      return result(input);
    });
    const pending = provider.snapshot(computer, {}, context);
    await started;
    const otherDriver = vi.fn();
    const other = new EgoBrowserProvider(file, otherDriver);
    expect(await other.snapshot(computer, {}, context)).toMatchObject({
      error: expect.stringContaining("busy"),
    });
    expect(otherDriver).not.toHaveBeenCalled();
    release();
    await pending;
  });
  it("latches interrupted commands across restarts rather than replaying", async () => {
    const driver = vi.fn().mockRejectedValue(new Error("SDK error may contain private values"));
    const { provider, file } = await fixture(driver);
    expect(
      await provider.navigate(computer, { url: "https://example.test/form" }, context),
    ).toMatchObject({ uncertain: true, error: expect.stringContaining("interrupted") });
    const restarted = new EgoBrowserProvider(file, driver);
    expect(await restarted.snapshot(computer, {}, context)).toMatchObject({
      error: expect.stringContaining("reset"),
    });
    expect(driver).toHaveBeenCalledTimes(1);
    expect(await readFile(`${file}.state`, "utf8")).not.toContain("private values");
  });
  it("requires observation after a partial batch and preserves the new popup page", async () => {
    const driver = vi.fn(async (input: EgoCommand) =>
      input.command === "act"
        ? { ...result(input), ok: false, completed: 1, page: "p2", error: "Popup opened" }
        : result(input),
    );
    const { provider } = await fixture(driver);
    await provider.snapshot(computer, {}, context);
    expect(await provider.act(computer, { actions }, context)).toMatchObject({
      ok: false,
      completed: 1,
    });
    await provider.act(computer, { actions }, context);
    expect(driver).toHaveBeenCalledTimes(2);
    await provider.snapshot(computer, {}, context);
    expect(driver.mock.calls.at(-1)?.[0].page).toBe("p2");
  });
  it("selects Ego only with an explicit host binding", async () => {
    expect(createBrowserProvider("computer").describe().id).toBe("computer");
    const { file } = await fixture();
    expect(createBrowserProvider("ego", { connectionFile: file }).describe().id).toBe("ego");
    expect(() => new EgoBrowserProvider("relative.json")).toThrow(/absolute/);
  });
});

// Exercise exactly the fixed JavaScript sent to Ego, with an offline SDK double.
const runProgram = new Function(
  "input",
  "taskSpace",
  `return (async () => {${EGO_BROWSER_PROGRAM}})();`,
) as (
  input: EgoCommand,
  taskSpace: unknown,
) => Promise<ReturnType<typeof result> & { error?: string }>;
function sdk() {
  const page = {
    info: vi.fn(async () => ({ url: "https://example.test/form", title: "Signup" })),
    goto: vi.fn(),
    snapshot: vi.fn(async () => 'textbox "Email" [ref=1]\nbutton "Continue" [ref=2]'),
    fill: vi.fn(),
    click: vi.fn(),
  };
  const task = { ownership: "agent", page: vi.fn(() => page) };
  const taskSpace = vi.fn(async () => task);
  const input: EgoCommand = {
    command: "act",
    actions,
    taskSpaceId: 7,
    page: "p1",
    allowedOrigins: connection.allowedOrigins,
    observedUrl: "https://example.test/form",
  };
  return { page, task, taskSpace, input };
}
describe("fixed Ego program", () => {
  it("runs a batch once and translates native snapshot refs", async () => {
    const f = sdk();
    const response = await runProgram(f.input, f.taskSpace);
    expect(response).toMatchObject({ ok: true, completed: 2, uncertain: false });
    expect(response.tree).toContain("[e1]");
    expect(response.elements[0]?.ref).toBe("e1");
    expect(f.page.fill).toHaveBeenCalledWith("@1", "example", { clearFirst: true });
    expect(f.page.click).toHaveBeenCalledWith("@2");
    expect(f.taskSpace).toHaveBeenCalledWith(7);
  });
  it("recognizes refs with stable locator and URL metadata", async () => {
    const f = sdk();
    f.page.snapshot.mockResolvedValue(
      'textbox [ref=6, loc=css:input[name="account"]]\nanchor [ref=7, url=https://example.test/next]',
    );
    const response = await runProgram({ ...f.input, command: "snapshot" }, f.taskSpace);
    expect(response.elements.map((element) => element.ref)).toEqual(["e6", "e7"]);
    expect(response.tree).toContain('[e6, loc=css:input[name="account"]]');
  });

  it("stops when control belongs to the user without creating another task", async () => {
    const f = sdk();
    f.task.ownership = "user";
    expect(await runProgram(f.input, f.taskSpace)).toMatchObject({
      ok: false,
      completed: 0,
      uncertain: false,
    });
    expect(f.page.fill).not.toHaveBeenCalled();
    expect(f.taskSpace).toHaveBeenCalledTimes(1);
  });
  it("does not read unconfigured pages or fill after the page changes", async () => {
    const f = sdk();
    f.page.info.mockResolvedValue({ url: "https://evil.test/", title: "Other" });
    expect(await runProgram(f.input, f.taskSpace)).toMatchObject({ ok: false, completed: 0 });
    expect(f.page.snapshot).not.toHaveBeenCalled();
    expect(f.page.fill).not.toHaveBeenCalled();
  });
  it("reports partial completion and uncertainty without echoing secrets or retrying", async () => {
    const f = sdk();
    f.page.click.mockRejectedValue(new Error("secret field value"));
    const response = await runProgram(f.input, f.taskSpace);
    expect(response).toMatchObject({ ok: false, completed: 1, uncertain: true });
    expect(response.error).not.toContain("secret field value");
    expect(f.page.click).toHaveBeenCalledTimes(1);
  });
  it("does not continue a batch across navigation", async () => {
    const f = sdk();
    f.page.info
      .mockResolvedValueOnce({ url: "https://example.test/form", title: "Signup" })
      .mockResolvedValue({ url: "https://example.test/next", title: "Next" });
    expect(await runProgram(f.input, f.taskSpace)).toMatchObject({
      ok: false,
      completed: 1,
      uncertain: false,
    });
    expect(f.page.click).not.toHaveBeenCalled();
  });
});
