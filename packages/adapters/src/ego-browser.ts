import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AdapterContext,
  BrowserActRequest,
  BrowserActResult,
  BrowserNavigateRequest,
  BrowserNavigateResult,
  BrowserProvider,
  BrowserSnapshotRequest,
  BrowserSnapshotResult,
  ComputerRef,
  PageBrowserCommand,
} from "@rakazo/adapter-kit";
import { z } from "zod";
import { EGO_BROWSER_PROGRAM } from "./ego-browser-program.js";

const origin = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}, "Expected an HTTP(S) origin without a path or credentials");

/** Host-owned binding: never writable from the bot's mounted home. */
export const BrowserConnection = z
  .object({
    provider: z.literal("ego"),
    userId: z.string().min(1),
    spaceId: z.string().min(1),
    computerHomeKey: z.string().min(1),
    botIds: z.array(z.string().min(1)).min(1),
    taskSpaceId: z.number().int().positive(),
    page: z.string().regex(/^p\d+$/),
    allowedOrigins: z.array(origin).min(1),
  })
  .strict();
export type BrowserConnection = z.infer<typeof BrowserConnection>;

const Result = z.object({
  ok: z.boolean(),
  completed: z.number().int().min(0),
  uncertain: z.boolean(),
  page: z.string().regex(/^p\d+$/),
  url: z.string(),
  title: z.string(),
  tree: z.string(),
  elements: z.array(
    z.object({ ref: z.string().regex(/^e\d+$/), role: z.string(), name: z.string() }),
  ),
  error: z.string().optional(),
});
type Result = z.infer<typeof Result>;
export type EgoCommand = PageBrowserCommand & {
  taskSpaceId: number;
  page: string;
  allowedOrigins: string[];
  observedUrl?: string;
};
export type EgoDriver = (input: EgoCommand, signal: AbortSignal) => Promise<unknown>;
const PREFIX = "RAKAZO_EGO_RESULT:";

/** No shell and no agent-supplied program. Inputs travel over stdin, not argv. */
export const runEgoCommand: EgoDriver = async (input, signal) => {
  signal.throwIfAborted();
  const script = `const input = JSON.parse(${JSON.stringify(JSON.stringify(input))});\nasync function runRakazoBrowserCommand() {${EGO_BROWSER_PROGRAM}\n}\nconst result = await runRakazoBrowserCommand();\nconsole.log(${JSON.stringify(PREFIX)} + JSON.stringify(result));\n`;
  return new Promise((resolve, reject) => {
    // Do not pass model keys, database credentials, or supervisor tokens to the CLI.
    const env = Object.fromEntries(
      ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "XDG_CONFIG_HOME", "XDG_DATA_HOME"].flatMap(
        (key) => (process.env[key] === undefined ? [] : [[key, process.env[key]!]]),
      ),
    );
    const child = spawn("ego-browser", ["nodejs"], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let stopped = false;
    const stop = () => {
      stopped = true;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(stop, 60_000);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length + stderr.length + chunk.length > 1024 * 1024) stop();
      else stdout += chunk;
    });
    // Ego prints console.log records on stderr in some CLI versions. Parse only
    // our structured record; never return raw diagnostics or field values.
    child.stderr.on("data", (chunk: string) => {
      if (stdout.length + stderr.length + chunk.length > 1024 * 1024) stop();
      else stderr += chunk;
    });
    child.stdin.on("error", () => undefined);
    child.once("error", () => {
      cleanup();
      reject(new Error("Ego CLI could not start"));
    });
    child.once("close", (code) => {
      cleanup();
      if (stopped || code !== 0) return reject(new Error("Ego command interrupted or unavailable"));
      const records = `${stdout}\n${stderr}`.split("\n").filter((line) => line.startsWith(PREFIX));
      if (records.length !== 1) return reject(new Error("Invalid Ego command response"));
      try {
        resolve(JSON.parse(records[0]!.slice(PREFIX.length)));
      } catch {
        reject(new Error("Invalid Ego command response"));
      }
    });
    child.stdin.end(script);
  });
};

const State = z.object({
  binding: z.string(),
  page: z.string().regex(/^p\d+$/),
  owner: z.string().nullable(),
  url: z.string(),
  refs: z.array(z.string().regex(/^e\d+$/)),
  halted: z.boolean(),
});
type State = z.infer<typeof State>;

export class EgoBrowserProvider implements BrowserProvider {
  readonly instructions =
    "Page navigation uses Ego on the operator's computer, not the Docker desktop. Use browser_navigate, browser_snapshot, and browser_act with observed eN refs. Batch independent field fills (up to 24 steps), then observe before the next page or save. Never run ego-browser or arbitrary host scripts through shell. Do not switch to Docker Chrome or computer_act if Ego fails. Use ask_user (not sandbox request_takeover) for login, MFA, dialogs, uploads, or a control handback in Ego; saved-login fills are not supported by this adapter. The operator must authorize returning control; never reclaim it yourself. Publishing and other consequential actions still require the existing user approval rules.";

  constructor(
    private readonly connectionFile: string,
    private readonly driver: EgoDriver = runEgoCommand,
  ) {
    if (!connectionFile || !path.isAbsolute(connectionFile)) {
      throw new Error("Ego requires an absolute BROWSER_CONNECTION_FILE outside bot homes");
    }
  }

  describe() {
    return {
      id: "ego",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { page: true, refs: true, keyless: true, computerDesktop: false },
    };
  }

  async navigate(
    computer: ComputerRef,
    request: BrowserNavigateRequest,
    context: AdapterContext,
  ): Promise<BrowserNavigateResult> {
    return this.command(computer, { command: "navigate", url: request.url }, context);
  }
  async snapshot(
    computer: ComputerRef,
    _request: BrowserSnapshotRequest,
    context: AdapterContext,
  ): Promise<BrowserSnapshotResult> {
    return this.command(computer, { command: "snapshot" }, context);
  }
  async act(
    computer: ComputerRef,
    request: BrowserActRequest,
    context: AdapterContext,
  ): Promise<BrowserActResult> {
    return this.command(computer, { command: "act", actions: request.actions }, context);
  }

  private async command(
    computer: ComputerRef,
    command: PageBrowserCommand,
    context: AdapterContext,
  ): Promise<Result> {
    const failure = (error: string, uncertain = false): Result => ({
      ok: false,
      completed: 0,
      uncertain,
      page: "p1",
      url: "",
      title: "",
      tree: "",
      elements: [],
      error,
    });
    if (context.signal.aborted) return failure("Browser request cancelled");
    let connection: BrowserConnection;
    try {
      connection = BrowserConnection.parse(JSON.parse(await readFile(this.connectionFile, "utf8")));
    } catch {
      return failure("Browser connection is missing or invalid. Ask the operator to configure it.");
    }
    if (
      context.userId !== connection.userId ||
      context.spaceId !== connection.spaceId ||
      computer.botId !== connection.computerHomeKey ||
      !context.botId ||
      !connection.botIds.includes(context.botId)
    ) {
      return failure("This run is not authorized for the configured host browser.");
    }
    if (command.command === "navigate") {
      try {
        const url = new URL(command.url);
        if (
          !/^https?:$/.test(url.protocol) ||
          url.username ||
          url.password ||
          !connection.allowedOrigins.includes(url.origin)
        ) {
          return failure(
            "Navigation origin is not configured. Ask the operator; do not switch browsers.",
          );
        }
      } catch {
        return failure("Invalid navigation URL");
      }
    }
    if (command.command === "act") {
      if (!command.actions.length || command.actions.length > 24)
        return failure("Expected 1–24 browser actions");
      for (const action of command.actions) {
        if (!["click", "fill", "type"].includes(action.kind) || !/^e\d+$/.test(action.ref))
          return failure("Use only refs from browser_snapshot");
        if (
          action.kind !== "click" &&
          (action.origin !== undefined || typeof action.text !== "string")
        ) {
          return failure(
            "Saved-login fills are unavailable in Ego. Ask the user to sign in directly in Ego.",
          );
        }
      }
    }
    const lock = `${this.connectionFile}.lock`;
    const stateFile = `${this.connectionFile}.state`;
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch {
      return failure(
        "Ego is busy or a previous process stopped while holding the browser lock. Wait or ask the operator; do not retry actions blindly.",
      );
    }
    const binding = JSON.stringify(connection);
    const owner = JSON.stringify([context.userId, context.spaceId, context.botId, context.runId]);
    let state: State = {
      binding,
      page: connection.page,
      owner: null,
      url: "",
      refs: [],
      halted: false,
    };
    const save = async () => {
      await writeFile(`${stateFile}.tmp`, JSON.stringify(state), { mode: 0o600 });
      await rename(`${stateFile}.tmp`, stateFile);
    };
    try {
      try {
        const stored = State.parse(JSON.parse(await readFile(stateFile, "utf8")));
        if (stored.binding === binding) state = stored;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          return failure("Browser state is invalid; operator review is required.");
      }
      if (state.halted)
        return failure(
          "A previous Ego command was interrupted. The operator must inspect Ego and reset the connection state before continuing.",
          true,
        );
      if (
        command.command === "act" &&
        (state.owner !== owner ||
          command.actions.some((action) => !state.refs.includes(action.ref)))
      ) {
        return failure(
          "Take a fresh browser_snapshot in this run before acting. Refs from another bot or run are not valid.",
        );
      }
      const input: EgoCommand = {
        ...command,
        taskSpaceId: connection.taskSpaceId,
        page: state.page,
        allowedOrigins: connection.allowedOrigins,
        observedUrl: state.url,
      };
      // Invalidate refs before dispatch; never replay after a process crash or uncertain result.
      state.owner = null;
      state.refs = [];
      state.halted = true;
      await save();
      let result: Result;
      try {
        context.signal.throwIfAborted();
        result = Result.parse(await this.driver(input, context.signal));
        if (
          command.command === "act" &&
          (result.completed > command.actions.length ||
            (result.ok && (result.completed !== command.actions.length || result.uncertain)))
        )
          throw new Error("Unconfirmed actions");
      } catch {
        return failure(
          "Ego command was interrupted or returned an invalid response. Inspect Ego before resetting the connection state; actions may have taken effect.",
          true,
        );
      }
      state = {
        binding,
        page: result.page,
        owner: result.ok ? owner : null,
        url: result.url,
        refs: result.ok ? result.elements.map((element) => element.ref) : [],
        halted: result.uncertain,
      };
      await save();
      return result;
    } catch {
      return failure(
        "Browser connection state could not be saved. Stop and ask the operator to inspect Ego.",
        true,
      );
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
}
