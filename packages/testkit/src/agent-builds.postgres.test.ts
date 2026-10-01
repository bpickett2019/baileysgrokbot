import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AdapterContext,
  AgentRuntimeEvent,
  BrowserActRequest,
  BrowserSnapshotRequest,
  BrowserSnapshotResult,
  ComputerRef,
  JobPublisher,
} from "@rakazo/adapter-kit";
import {
  createAgentBuild,
  createBuildModelGuard,
  EncryptedSecretStore,
  FakeBrowserProvider,
  resolveBuildScreenContext,
  reviewAgentBuild,
  startAgentBuild,
} from "@rakazo/adapters";
import { BuildManifest } from "@rakazo/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { createApp } from "../../../apps/api/src/app.ts";
import { storeBotSecret } from "../../adapters/src/bot-secrets.js";
import { discardBotIntroFromCreate } from "./discard-bot-intro.js";

const integration =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL ? describe : describe.skip;
const quietJobs: JobPublisher = {
  enqueue: async () => {},
  cancel: async () => {},
  close: async () => {},
};
const rates = { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 };
const request = {
  provider: "fixture",
  model: "fixture",
  rates,
  maxInputTokens: 1000,
  maxOutputTokens: 100,
};

integration("durable delegated builds", () => {
  let handles: Awaited<ReturnType<typeof createApp>>;
  const dataDir = mkdtempSync(path.join(tmpdir(), "rakazo-build-fixtures-"));
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const values = new Map<string, { fee: number }>();
  const loseResponse = new Set<string>();
  const driftOnWrite = new Map<string, string>();
  const calls: Array<{ url: string; method: string }> = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const key = String(url);
    const method = init?.method ?? "GET";
    calls.push({ url: key, method });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fake-build-only-token");
    if (method === "PUT") {
      values.set(key, JSON.parse(String(init?.body)));
      const earlier = driftOnWrite.get(key);
      if (earlier) values.set(earlier, { fee: 99 });
      if (loseResponse.has(key)) throw new Error("Fixture lost response after writing");
    }
    return Response.json(values.get(key) ?? { fee: 0 });
  });
  const browserUrl = "https://fixture.example/event?evtstub=approved";
  const pages = {
    [browserUrl]: {
      title: "Fixture Event",
      html: '<h1>Fixture Event</h1><label>Fee<input aria-label="Fee" value="0"></label><button>Save</button>',
    },
  };
  const browserCalls: AdapterContext[] = [];
  const snapshots = new Map<string, BrowserSnapshotResult>();
  const browser = new (class extends FakeBrowserProvider {
    override async snapshot(
      computer: ComputerRef,
      request: BrowserSnapshotRequest,
      context: AdapterContext,
    ) {
      const result = await super.snapshot(computer, request, context);
      snapshots.set(context.botId!, result);
      return result;
    }
    override async act(computer: ComputerRef, request: BrowserActRequest, context: AdapterContext) {
      browserCalls.push(context);
      const before = snapshots.get(context.botId!)!;
      const result = await super.act(computer, request, context);
      if (
        result.ok &&
        request.actions.some(
          (action) =>
            action.kind === "click" &&
            before.elements.find((node) => node.ref === action.ref)?.name === "Save",
        )
      ) {
        const saved = result.elements?.find((node) => node.name === "Fee")?.value;
        pages[browserUrl].html =
          `<h1>Fixture Event</h1><label>Fee<input aria-label="Fee" value="${saved}"></label><button>Save</button>`;
      }
      return result;
    }
  })({ pages });
  beforeAll(async () => {
    // Durable run transitions can exceed the one-second polling default under load.
    vi.setConfig({ expect: { poll: { timeout: 10_000 } }, testTimeout: 15_000 });
    const { createApp } = await import("../../../apps/api/src/app.ts");
    handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      dataDir,
      browser,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      defaultProvider: "scripted",
      defaultModel: "scripted",
      remoteConnectors: {
        fetch,
        resolveHostname: async () => [{ address: "203.0.113.10", family: 4 }],
      },
    });
  });
  afterAll(async () => {
    await handles?.stop();
    vi.resetConfig();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("executes browser edits under the specialist and verifies in the same profile under QA", async () => {
    const fixture = await seed("browser");
    const manifest = BuildManifest.parse({
      ...fixture.manifest,
      packages: [
        {
          ...fixture.manifest.packages[0],
          kind: "browser",
          apiSteps: [],
          allowedClicks: ["Save"],
          readbackUrl: browserUrl,
        },
      ],
    });
    const id = await createAgentBuild(handles, fixture.actor, manifest);
    const seen: Array<{ botId: string; screenBotId?: string }> = [];
    const runtime = vi
      .spyOn(handles.runtime, "run")
      .mockImplementation(async function* (request, context): AsyncIterable<AgentRuntimeEvent> {
        seen.push({ botId: context.botId!, screenBotId: context.screenBotId });
        expect(request.history).toEqual([]);
        expect(request.modelCallGuard).toBeDefined();
        expect(
          request.tools.some((tool) =>
            ["shell", "run_subagent", "message_bot", "secret_request"].includes(tool.name),
          ),
        ).toBe(false);
        const phase = JSON.parse(request.prompt).phase;
        yield {
          type: "tool",
          name: "browser_navigate",
          args: { url: browserUrl },
          executionId: `${request.runId}:navigate`,
        };
        if (phase === "execute") {
          yield {
            type: "tool",
            name: "browser_snapshot",
            args: {},
            executionId: `${request.runId}:snapshot`,
          };
          const snapshot = snapshots.get(context.botId!)!;
          yield {
            type: "tool",
            name: "browser_act",
            executionId: `${request.runId}:save`,
            args: {
              actions: [
                {
                  kind: "fill",
                  ref: snapshot.elements.find((node) => node.name === "Fee")!.ref,
                  text: "25",
                },
                { kind: "click", ref: snapshot.elements.find((node) => node.name === "Save")!.ref },
              ],
            },
          };
        }
        yield {
          type: "tool",
          name: "build_verify",
          args: {},
          executionId: `${request.runId}:verify`,
        };
        yield { type: "done", text: "Fixture saved and checked." };
      });
    try {
      await startAgentBuild(handles, fixture.actor, id);
      await expect
        .poll(async () => {
          const build = await handles.prisma.agentBuild.findUniqueOrThrow({ where: { id } });
          return build.status === "paused"
            ? await handles.prisma.run.findMany({
                where: { buildPackage: { buildId: id } },
                select: { status: true, error: true },
              })
            : build.status;
        })
        .toBe("completed");
      expect(seen).toEqual([
        { botId: fixture.worker, screenBotId: fixture.chief },
        { botId: fixture.qa, screenBotId: fixture.chief },
      ]);
      expect(browserCalls).toHaveLength(1);
      expect(browserCalls[0]).toMatchObject({ botId: fixture.worker, screenBotId: fixture.chief });
      expect(pages[browserUrl].html).toContain('value="25"');
      const audit = await handles.prisma.event.findMany({
        where: { botId: { in: [fixture.worker, fixture.qa] }, type: "agent.tool.completed" },
      });
      expect(audit.some((event) => event.botId === fixture.worker)).toBe(true);
      expect(audit.every((event) => event.botId !== fixture.chief)).toBe(true);
    } finally {
      runtime.mockRestore();
    }
  });

  it("holds both browser and agent leases through takeover, denies takeover through Chief, and resumes automatically", async () => {
    const fixture = await seed("build-takeover");
    const manifest = BuildManifest.parse({
      ...fixture.manifest,
      packages: [
        { ...fixture.manifest.packages[0], kind: "browser", apiSteps: [], readbackUrl: browserUrl },
      ],
    });
    const id = await createAgentBuild(handles, fixture.actor, manifest);
    const runtime = vi
      .spyOn(handles.runtime, "run")
      .mockImplementation(async function* (request): AsyncIterable<AgentRuntimeEvent> {
        if (JSON.parse(request.prompt).phase === "execute" && !request.resumeFromCheckpoint) {
          yield { type: "takeover", reason: "Fixture sign-in handoff" };
          return;
        }
        yield {
          type: "tool",
          name: "build_verify",
          args: {},
          executionId: `${request.runId}:verify`,
        };
        yield { type: "done", text: "Read-back checked." };
      });
    try {
      await startAgentBuild(handles, fixture.actor, id);
      await expect
        .poll(() =>
          handles.prisma.run.count({
            where: { buildPackage: { buildId: id }, status: "waiting_takeover" },
          }),
        )
        .toBe(1);
      const waiting = await handles.prisma.run.findFirstOrThrow({
        where: { buildPackage: { buildId: id } },
      });
      const leases = await handles.prisma.computerExecutionLease.findMany({
        where: { runId: waiting.id },
      });
      expect(leases.map((lease) => lease.botId).sort()).toEqual(
        [fixture.chief, fixture.worker].sort(),
      );
      expect(leases.every((lease) => lease.expiresAt.getTime() > Date.now())).toBe(true);
      await expect(
        rpc(fixture.cookie, "computer/takeover", { botId: fixture.chief }),
      ).rejects.toThrow();
      await rpc(fixture.cookie, "computer/takeover", { botId: fixture.worker });
      pages[browserUrl].html =
        '<h1>Fixture Event</h1><label>Fee<input aria-label="Fee" value="25"></label><button>Save</button>';
      await rpc(fixture.cookie, "computer/release", { botId: fixture.worker });
      await expect
        .poll(
          async () => (await handles.prisma.agentBuild.findUniqueOrThrow({ where: { id } })).status,
        )
        .toBe("completed");
      expect(
        (await handles.prisma.run.findUniqueOrThrow({ where: { id: waiting.id } })).leaseFence,
      ).toBeGreaterThan(waiting.leaseFence);
    } finally {
      runtime.mockRestore();
    }
  });

  it("keeps a scoped operator answer on resume without restoring unrelated history", async () => {
    const fixture = await seed("clarification");
    pages[browserUrl].html =
      '<h1>Fixture Event</h1><label>Fee<input aria-label="Fee" value="25"></label><button>Save</button>';
    const manifest = BuildManifest.parse({
      ...fixture.manifest,
      packages: [
        { ...fixture.manifest.packages[0], kind: "browser", apiSteps: [], readbackUrl: browserUrl },
      ],
    });
    const id = await createAgentBuild(handles, fixture.actor, manifest);
    const answers: string[] = [];
    const runtime = vi
      .spyOn(handles.runtime, "run")
      .mockImplementation(async function* (request): AsyncIterable<AgentRuntimeEvent> {
        const packet = JSON.parse(request.prompt);
        expect(request.history).toEqual([]);
        if (packet.phase === "execute" && !packet.operatorClarification) {
          yield {
            type: "ask",
            text: "Confirm the read-back approach",
            actions: [{ id: "read", label: "Use saved values" }],
          };
          return;
        }
        if (packet.operatorClarification) answers.push(packet.operatorClarification);
        yield {
          type: "tool",
          name: "build_verify",
          args: {},
          executionId: `${request.runId}:verify`,
        };
        yield { type: "done", text: "Read-back checked." };
      });
    try {
      await startAgentBuild(handles, fixture.actor, id);
      await expect
        .poll(() =>
          handles.prisma.run.count({
            where: { buildPackage: { buildId: id }, status: "waiting_input" },
          }),
        )
        .toBe(1);
      const run = await handles.prisma.run.findFirstOrThrow({
        where: { buildPackage: { buildId: id } },
      });
      const message = await handles.prisma.message.findFirstOrThrow({
        where: { runId: run.id, role: "bot" },
        orderBy: { seq: "desc" },
      });
      await rpc(fixture.cookie, "threads/answer", {
        botId: fixture.worker,
        runId: run.id,
        messageId: message.id,
        answer: "read",
      });
      await expect
        .poll(
          async () => (await handles.prisma.agentBuild.findUniqueOrThrow({ where: { id } })).status,
        )
        .toBe("completed");
      expect(answers).toEqual([expect.stringContaining("Use saved values")]);
    } finally {
      runtime.mockRestore();
    }
  });

  it.each(["shell", "unapproved-fill", "unapproved-click", "stale-receipt"])(
    "blocks %s instead of reporting verified completion",
    async (mode) => {
      const fixture = await seed(mode);
      pages[browserUrl].html =
        '<h1>Fixture Event</h1><label>Fee<input aria-label="Fee" value="25"></label><button>Save</button>';
      const manifest = BuildManifest.parse({
        ...fixture.manifest,
        packages: [
          {
            ...fixture.manifest.packages[0],
            kind: "browser",
            apiSteps: [],
            readbackUrl: browserUrl,
          },
        ],
      });
      const id = await createAgentBuild(handles, fixture.actor, manifest);
      const before = browserCalls.length;
      const runtime = vi
        .spyOn(handles.runtime, "run")
        .mockImplementation(async function* (request, context): AsyncIterable<AgentRuntimeEvent> {
          yield {
            type: "tool",
            name: "browser_navigate",
            args: { url: browserUrl },
            executionId: `${request.runId}:nav`,
          };
          if (mode === "stale-receipt")
            yield {
              type: "tool",
              name: "build_verify",
              args: {},
              executionId: `${request.runId}:early-verify`,
            };
          yield {
            type: "tool",
            name: "browser_snapshot",
            args: {},
            executionId: `${request.runId}:snapshot`,
          };
          const snapshot = snapshots.get(context.botId!)!;
          if (mode === "shell")
            yield {
              type: "tool",
              name: "shell",
              args: { command: "echo forbidden" },
              executionId: `${request.runId}:blocked`,
            };
          else
            yield {
              type: "tool",
              name: "browser_act",
              executionId: `${request.runId}:edit`,
              args: {
                actions:
                  mode === "unapproved-click"
                    ? [
                        {
                          kind: "click",
                          ref: snapshot.elements.find((node) => node.name === "Save")!.ref,
                        },
                      ]
                    : [
                        {
                          kind: "fill",
                          ref: snapshot.elements.find((node) => node.name === "Fee")!.ref,
                          text: mode === "stale-receipt" ? "25" : "26",
                        },
                      ],
              },
            };
          yield { type: "done", text: "Claimed complete without a fresh receipt." };
        });
      try {
        await startAgentBuild(handles, fixture.actor, id);
        await expect
          .poll(
            async () =>
              (await handles.prisma.agentBuild.findUniqueOrThrow({ where: { id } })).status,
          )
          .toBe("paused");
        expect(
          await handles.prisma.buildWorkPackage.count({
            where: { buildId: id, status: "verified" },
          }),
        ).toBe(0);
        expect(browserCalls.length - before).toBe(mode === "stale-receipt" ? 1 : 0);
      } finally {
        runtime.mockRestore();
      }
    },
  );

  it("automatically executes dependent API packages under specialists and independent QA without any model calls", async () => {
    const fixture = await seed("pipeline");
    const manifest = BuildManifest.parse({
      ...fixture.manifest,
      packages: [
        fixture.manifest.packages[0],
        {
          ...fixture.manifest.packages[0],
          key: "second",
          title: "Second fixture",
          dependsOn: ["fee"],
          apiSteps: steps(`${fixture.url}/second`),
        },
      ],
    });
    const runtime = vi.spyOn(handles.runtime, "run");
    try {
      const view = await rpc<{ id: string }>(fixture.cookie, "builds/create", manifest);
      await rpc(fixture.cookie, "builds/start", { id: view.id });
      await expect
        .poll(
          async () =>
            (await handles.prisma.agentBuild.findUniqueOrThrow({ where: { id: view.id } })).status,
        )
        .toBe("completed");
      const packets = await handles.prisma.buildWorkPackage.findMany({
        where: { buildId: view.id },
      });
      expect(packets.every((packet) => packet.status === "verified")).toBe(true);
      expect(
        (
          await handles.prisma.run.findMany({
            where: { buildPackageId: { in: packets.map((packet) => packet.id) } },
          })
        )
          .map((run) => run.botId)
          .sort(),
      ).toEqual(
        [fixture.worker, fixture.worker, fixture.qa, fixture.qa, fixture.qa, fixture.qa].sort(),
      );
      expect(
        calls.filter((call) => call.url.startsWith(fixture.url)).map((call) => call.method),
      ).toEqual(["PUT", "GET", "GET", "PUT", "GET", "GET", "GET", "GET"]);
      expect(runtime).not.toHaveBeenCalled();
      const first = await handles.prisma.run.findFirstOrThrow({
        where: { buildPackageId: packets[0]!.id },
      });
      await handles.executor.continueRun(first.id, "duplicate-delivery");
      expect(
        calls.filter((call) => call.url.startsWith(fixture.url) && call.method === "PUT"),
      ).toHaveLength(2);
      expect(await handles.prisma.buildModelCall.count({ where: { buildId: view.id } })).toBe(0);
    } finally {
      runtime.mockRestore();
    }
  });

  it("catches later changes to an earlier package during the final read-only sweep", async () => {
    const fixture = await seed("final-drift");
    driftOnWrite.set(`${fixture.url}/second`, fixture.url);
    const manifest = BuildManifest.parse({
      ...fixture.manifest,
      packages: [
        fixture.manifest.packages[0],
        {
          ...fixture.manifest.packages[0],
          key: "second",
          title: "Second fixture",
          dependsOn: ["fee"],
          apiSteps: steps(`${fixture.url}/second`),
        },
      ],
    });
    const id = await createAgentBuild(handles, fixture.actor, manifest);
    await startAgentBuild(handles, fixture.actor, id);
    await expect
      .poll(
        async () => (await handles.prisma.agentBuild.findUniqueOrThrow({ where: { id } })).status,
      )
      .toBe("paused");
    expect(await handles.prisma.agentBuild.findUniqueOrThrow({ where: { id } })).toMatchObject({
      finalVerification: true,
    });
    const packet = await handles.prisma.buildWorkPackage.findUniqueOrThrow({
      where: { buildId_key: { buildId: id, key: "fee" } },
    });
    expect(packet.status).toBe("blocked");
    expect(packet.evidence).toMatchObject({
      checks: [expect.objectContaining({ expected: "25", actual: "99", matched: false })],
    });
    expect(
      calls.filter((call) => call.url.startsWith(fixture.url) && call.method === "PUT"),
    ).toHaveLength(2);
  });

  it("pauses on an uncertain API write; operator-approved read-only verification never repeats the write", async () => {
    const fixture = await seed("uncertain-api");
    loseResponse.add(fixture.url);
    const id = await createAgentBuild(handles, fixture.actor, fixture.manifest);
    await startAgentBuild(handles, fixture.actor, id);
    await expect
      .poll(
        async () => (await handles.prisma.agentBuild.findUniqueOrThrow({ where: { id } })).status,
      )
      .toBe("paused");
    expect(calls.filter((call) => call.url === fixture.url)).toHaveLength(1);
    const packet = await handles.prisma.buildWorkPackage.findFirstOrThrow({
      where: { buildId: id },
    });
    expect(
      await handles.prisma.buildApiCall.findFirst({ where: { packageId: packet.id } }),
    ).toMatchObject({ state: "executing" });
    await reviewAgentBuild(handles, fixture.actor, {
      id,
      action: "verify",
      packageKey: "fee",
      note: "Review saved values only; do not retry the uncertain write.",
    });
    await expect
      .poll(
        async () => (await handles.prisma.agentBuild.findUniqueOrThrow({ where: { id } })).status,
      )
      .toBe("completed");
    expect(calls.filter((call) => call.url === fixture.url).map((call) => call.method)).toEqual([
      "PUT",
      "GET",
    ]);
    expect(await handles.prisma.buildReview.count({ where: { buildId: id } })).toBe(2);
  });

  it("pauses an expired browser worker instead of automatically replaying possibly saved edits", async () => {
    const fixture = await seed("crashed-browser");
    const { id, runId } = await runningBudgetFixture(fixture, 5000);
    const guard = (await createBuildModelGuard(handles.prisma, runId))!;
    await guard.reserve(request);
    await handles.prisma.run.update({
      where: { id: runId },
      data: { leaseExpiresAt: new Date(Date.now() - 10_000) },
    });
    await expect(guard.reserve(request)).rejects.toThrow("paused, stopped or reassigned");
    const runtime = vi.spyOn(handles.runtime, "run");
    try {
      await handles.executor.continueRun(runId, "recovery-worker");
      await handles.executor.continueRun(runId, "duplicate-recovery");
      expect(runtime).not.toHaveBeenCalled();
      expect(await handles.prisma.agentBuild.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: "paused",
        reservedMicrousd: 1100,
        modelCalls: 1,
      });
      expect(await handles.prisma.run.findUniqueOrThrow({ where: { id: runId } })).toMatchObject({
        status: "failed",
      });
      expect(await handles.prisma.buildModelCall.findFirst({ where: { runId } })).toMatchObject({
        state: "uncertain",
      });
    } finally {
      runtime.mockRestore();
    }
  });

  it.each(["space", "user"])(
    "honors explicit %s erasure without orphaning private manifests or ledger rows",
    async (owner) => {
      const fixture = await seed(`erase-${owner}`);
      const { id, runId } = await runningBudgetFixture(fixture, 5000);
      await (await createBuildModelGuard(handles.prisma, runId))!.reserve(request);
      const packet = await handles.prisma.buildWorkPackage.findFirstOrThrow({
        where: { buildId: id },
      });
      const api = await handles.prisma.buildApiCall.create({
        data: { packageId: packet.id, runId, phase: "execute", stepId: "fixture" },
      });
      await reviewAgentBuild({ prisma: handles.prisma, jobs: quietJobs }, fixture.actor, {
        id,
        action: "pause",
        note: "Disposable fixture erasure",
      });
      // Only disposable fixture records; normal build reviews never purge accounting.
      if (owner === "space")
        await handles.prisma.space.delete({ where: { id: fixture.actor.spaceId } });
      else await handles.prisma.user.delete({ where: { id: fixture.actor.userId } });
      expect(await handles.prisma.agentBuild.findUnique({ where: { id } })).toBeNull();
      expect(await handles.prisma.buildModelCall.count({ where: { buildId: id } })).toBe(0);
      expect(await handles.prisma.buildReview.count({ where: { buildId: id } })).toBe(0);
      expect(await handles.prisma.buildParticipant.count({ where: { buildId: id } })).toBe(0);
      expect(await handles.prisma.buildApiCall.findUnique({ where: { id: api.id } })).toBeNull();
    },
  );

  it("serializes competing reservations, settles exactly once and retains accounting across guard instances", async () => {
    const fixture = await seed("budget");
    const { id, runId } = await runningBudgetFixture(fixture, 1500);
    const guards = await Promise.all([
      createBuildModelGuard(handles.prisma, runId),
      createBuildModelGuard(handles.prisma, runId),
    ]);
    const results = await Promise.allSettled(guards.map((guard) => guard!.reserve(request)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await handles.prisma.agentBuild.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "paused",
      reservedMicrousd: 1100,
      modelCalls: 1,
    });
    const approved = results.find(
      (result) => result.status === "fulfilled",
    ) as PromiseFulfilledResult<Awaited<ReturnType<NonNullable<(typeof guards)[0]>["reserve"]>>>;
    const usage = { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };
    await Promise.all([approved.value.settle(usage), approved.value.settle(usage)]);
    expect(await handles.prisma.agentBuild.findUniqueOrThrow({ where: { id } })).toMatchObject({
      spentMicrousd: 110,
      reservedMicrousd: 0,
      inputTokens: 100,
      outputTokens: 10,
      modelCalls: 1,
    });
    await expect(
      (await createBuildModelGuard(handles.prisma, runId))!.reserve(request),
    ).rejects.toThrow("paused");
    await handles.prisma.run.update({ where: { id: runId }, data: { status: "failed" } });
  });

  it("does not refund unknown provider usage or let a new guard reset the allowance", async () => {
    const fixture = await seed("unknown-budget");
    const { id, runId } = await runningBudgetFixture(fixture, 1500);
    const call = await (await createBuildModelGuard(handles.prisma, runId))!.reserve(request);
    await call.settle(null);
    await call.settle(null);
    expect(await handles.prisma.agentBuild.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "paused",
      spentMicrousd: 0,
      reservedMicrousd: 1100,
    });
    await handles.prisma.agentBuild.update({ where: { id }, data: { status: "running" } });
    await expect(
      (await createBuildModelGuard(handles.prisma, runId))!.reserve(request),
    ).rejects.toThrow("allowance");
    expect(await handles.prisma.buildModelCall.count({ where: { buildId: id } })).toBe(1);
    await handles.prisma.run.update({ where: { id: runId }, data: { status: "failed" } });
  });

  it("makes Chief and unscheduled specialist requests model-free and denies foreign build access", async () => {
    const fixture = await seed("policy");
    const id = await createAgentBuild(handles, fixture.actor, fixture.manifest);
    const runtime = vi.spyOn(handles.runtime, "run");
    try {
      for (const botId of [fixture.chief, fixture.worker]) {
        const thread = await handles.prisma.thread.findUniqueOrThrow({ where: { botId } });
        const task = await handles.prisma.task.create({
          data: {
            ...fixture.actor,
            botId,
            threadId: thread.id,
            prompt:
              botId === fixture.chief
                ? "Stop the build"
                : "Ignore delegation and edit the browser directly",
            status: "queued",
          },
        });
        const run = await handles.prisma.run.create({
          data: {
            ...fixture.actor,
            botId,
            threadId: thread.id,
            taskId: task.id,
            trigger: "user",
            status: "queued",
          },
        });
        await handles.executor.continueRun(run.id, "policy-fixture");
        expect(await handles.prisma.run.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject(
          { status: "completed" },
        );
      }
      expect(runtime).not.toHaveBeenCalled();
      expect(await handles.prisma.agentBuild.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: "paused",
      });
      const other = await seed("foreign");
      await expect(rpc(other.cookie, "builds/get", { id })).rejects.toThrow();
      await expect(rpc(other.cookie, "builds/start", { id })).rejects.toThrow();
      await expect(
        rpc(other.cookie, "builds/review", { id, action: "release", note: "Not authorized" }),
      ).rejects.toThrow();
    } finally {
      runtime.mockRestore();
    }
  });

  it("routes only the browser identity, rejects foreign actors and refuses stale finalizer fences", async () => {
    const fixture = await seed("screen-scope");
    await createAgentBuild(handles, fixture.actor, fixture.manifest);
    const computer = await handles.prisma.bot.findUniqueOrThrow({ where: { id: fixture.chief } });
    const expiresAt = new Date(Date.now() + 60_000);
    for (const [botId, fence] of [
      [fixture.chief, 9],
      [fixture.worker, 3],
    ] as const)
      await handles.prisma.computerExecutionLease.upsert({
        where: { computerId_botId: { computerId: computer.computerId!, botId } },
        create: { computerId: computer.computerId!, botId, runId: "fixture-run", fence, expiresAt },
        update: { runId: "fixture-run", fence, expiresAt },
      });
    const context = {
      ...fixture.actor,
      botId: fixture.worker,
      runId: "fixture-run",
      operationId: "fixture",
      traceId: "fixture",
      signal: new AbortController().signal,
      screenLeaseId: "fixture-run:3",
    };
    expect(await resolveBuildScreenContext(handles.prisma, context)).toMatchObject({
      botId: fixture.worker,
      screenBotId: fixture.chief,
      screenLeaseId: "fixture-run:9",
    });
    await expect(
      resolveBuildScreenContext(handles.prisma, { ...context, screenLeaseId: "fixture-run:2" }),
    ).rejects.toThrow("Stale");
    expect(
      await resolveBuildScreenContext(
        handles.prisma,
        { ...context, screenLeaseId: "fixture-run:2" },
        undefined,
        true,
      ),
    ).toMatchObject({ screenBotId: fixture.chief, screenLeaseId: "fixture-run:9" });
    await expect(
      resolveBuildScreenContext(handles.prisma, context, "wrong-provider-reference", true),
    ).rejects.toThrow("computer changed");
    await expect(
      resolveBuildScreenContext(handles.prisma, { ...context, userId: "foreign" }),
    ).rejects.toThrow("denied");
  });

  async function runningBudgetFixture(fixture: Awaited<ReturnType<typeof seed>>, ceiling: number) {
    const manifest = BuildManifest.parse({
      ...fixture.manifest,
      maxMicrousd: ceiling,
      packages: [
        { ...fixture.manifest.packages[0], kind: "browser", apiSteps: [], maxMicrousd: ceiling },
      ],
    });
    const id = await createAgentBuild(
      { prisma: handles.prisma, jobs: quietJobs },
      fixture.actor,
      manifest,
    );
    const runId = await handles.prisma.$transaction(async (tx) => {
      const packet = await tx.buildWorkPackage.findFirstOrThrow({ where: { buildId: id } });
      const thread = await tx.thread.findUniqueOrThrow({ where: { botId: fixture.worker } });
      const task = await tx.task.create({
        data: {
          ...fixture.actor,
          botId: fixture.worker,
          threadId: thread.id,
          prompt: "Budget fixture",
          status: "running",
        },
      });
      const run = await tx.run.create({
        data: {
          ...fixture.actor,
          botId: fixture.worker,
          threadId: thread.id,
          taskId: task.id,
          trigger: "user",
          status: "running",
          leaseOwner: "fixture",
          leaseExpiresAt: new Date(Date.now() + 600_000),
          buildPackageId: packet.id,
          buildPhase: "execute",
        },
      });
      await tx.buildWorkPackage.update({
        where: { id: packet.id },
        data: { status: "running", activeRunId: run.id },
      });
      await tx.agentBuild.update({ where: { id }, data: { status: "running" } });
      return run.id;
    });
    return { id, runId };
  }
  async function seed(label: string) {
    const response = await handles.app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({
        email: `build-${label}-${stamp}@rakazo.test`,
        password: "password12",
        name: "Build Fixture",
      }),
    });
    expect(response.status).toBeLessThan(400);
    const cookie = `better-auth.session_token=${(response.headers.get("set-cookie") ?? "").match(/better-auth\.session_token=([^;]+)/)![1]}`;
    const actor = await rpc<{ spaceId: string; userId: string }>(cookie, "me");
    const ids: string[] = [];
    for (const name of ["Coordinator", "Specialist", "Verifier"])
      ids.push(
        (
          await rpc<{ id: string }>(cookie, "bots/create", {
            name,
            title: "",
            description: "",
            instructions: "",
            notifyOnFinish: false,
          })
        ).id,
      );
    const [chief, worker, qa] = ids as [string, string, string];
    const first = await handles.prisma.bot.findUniqueOrThrow({ where: { id: chief } });
    await handles.prisma.bot.updateMany({
      where: { id: { in: [worker, qa] } },
      data: { computerId: first.computerId },
    });
    const secretStore = new EncryptedSecretStore(process.env.ENCRYPTION_KEY!);
    for (const botId of [worker, qa])
      await handles.prisma.$transaction((tx) =>
        storeBotSecret({
          tx,
          secretStore,
          scope: { spaceId: actor.spaceId, userId: actor.userId, botId },
          destination: {
            name: "fixture-token",
            origin: "https://api.fixture.example",
            auth: { type: "bearer" },
          },
          plaintext: "fake-build-only-token",
        }),
      );
    const url = `https://api.fixture.example/events/${label}-${stamp}/fee`;
    const manifest = BuildManifest.parse({
      title: "Fixture build",
      coordinatorId: chief,
      browserOwnerId: chief,
      targetUrl: "https://fixture.example/event?evtstub=approved",
      targetIdentity: "Fixture Event",
      packages: [
        {
          key: "fee",
          title: "Fee fixture",
          agentId: worker,
          verifierId: qa,
          instructions: "Set only the approved fee.",
          kind: "api",
          apiSteps: steps(url),
          checks: [
            {
              id: "fee",
              source: "Fixture!B2",
              label: "Fee",
              expected: "25",
              responseStep: "read",
              jsonPointer: "/fee",
            },
          ],
        },
      ],
    });
    return {
      actor: { spaceId: actor.spaceId, userId: actor.userId },
      cookie,
      chief,
      worker,
      qa,
      manifest,
      url,
    };
  }
  function steps(url: string) {
    return [
      {
        id: "write",
        request: { name: "fixture-token", method: "PUT" as const, url, body: '{"fee":25}' },
      },
      { id: "read", request: { name: "fixture-token", method: "GET" as const, url } },
    ];
  }
  async function rpc<T>(cookie: string, procedure: string, body: unknown = {}): Promise<T> {
    const response = await handles.app.request(`/rpc/${procedure}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173", cookie },
      body: JSON.stringify({ json: body }),
    });
    const payload = (await response.json()) as { json?: T; error?: { message?: string } };
    if (!response.ok || payload.error)
      throw new Error(payload.error?.message ?? `${procedure} failed (${response.status})`);
    return discardBotIntroFromCreate(handles, cookie, procedure, payload.json as T);
  }
});
