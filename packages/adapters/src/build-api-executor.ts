import type { JobPublisher } from "@rakazo/adapter-kit";
import type { Prisma, PrismaClient, ThreadEvents } from "@rakazo/db";
import { buildRunScope, finishBuildRun, lockBuild } from "./agent-builds.js";
import { requestWithBotSecret } from "./bot-secrets.js";

type SecretInput = Parameters<typeof requestWithBotSecret>[0];
type Deps = {
  prisma: PrismaClient;
  jobs: JobPublisher;
  events: ThreadEvents;
  secretStore: SecretInput["secretStore"];
  secretHttp?: SecretInput["remote"];
};

export function readJsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  if (!pointer.startsWith("/")) throw new Error("A JSON pointer must start with /.");
  let current = value;
  for (const part of pointer.slice(1).split("/")) {
    const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!current || typeof current !== "object" || !Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Executes only pre-approved, literal requests. No LLM, arbitrary script, secret export or DELETE. */
export async function executeBuildApiRun(
  deps: Deps,
  runId: string,
  workerId: string,
): Promise<boolean> {
  const scope = await buildRunScope(deps.prisma, runId);
  if (scope?.definition.kind !== "api") return false;
  const fence = scope.run.leaseFence + 1;
  const claimed = await deps.prisma.run.updateMany({
    where: {
      id: runId,
      leaseFence: scope.run.leaseFence,
      OR: [
        { status: "queued" },
        { status: { in: ["leased", "running"] }, leaseExpiresAt: { lt: new Date() } },
      ],
    },
    data: {
      status: "running",
      leaseOwner: workerId,
      leaseFence: fence,
      leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
      startedAt: scope.run.startedAt ?? new Date(),
    },
  });
  if (!claimed.count) return true;
  const attempt = await deps.prisma.attempt.create({ data: { runId, fence, status: "running" } });
  let error: string | undefined;
  try {
    const results = new Map<string, unknown>();
    for (const step of scope.definition.apiSteps) {
      if (scope.run.buildPhase === "verify" && step.request.method !== "GET") continue;
      const prior = await deps.prisma.$transaction(async (tx) => {
        const build = await lockBuild(tx, scope.build.id);
        const packet = await tx.buildWorkPackage.findUniqueOrThrow({
          where: { id: scope.packet.id },
        });
        const computer = await tx.computer.findUniqueOrThrow({ where: { id: build.computerId } });
        if (
          build.status !== "running" ||
          packet.activeRunId !== runId ||
          packet.toolCalls >= scope.definition.maxToolCalls
        )
          throw new Error("Build is paused, reassigned, or out of tool allowance.");
        if (computer.controlHolder === "user")
          throw new Error("The user controls the build computer.");
        const renewed = await tx.run.updateMany({
          where: {
            id: runId,
            status: "running",
            leaseOwner: workerId,
            leaseFence: fence,
            leaseExpiresAt: { gt: new Date() },
          },
          data: { leaseExpiresAt: new Date(Date.now() + 5 * 60_000) },
        });
        if (!renewed.count) throw new Error("API execution was stopped.");
        const where = {
          packageId_phase_stepId: {
            packageId: packet.id,
            phase: scope.run.buildPhase ?? "execute",
            stepId: step.id,
          },
        };
        const existing = await tx.buildApiCall.findUnique({ where });
        if (step.request.method !== "GET" && existing) {
          if (existing.state !== "completed")
            throw new Error(
              "A previous API write has an uncertain outcome. Read back and review; do not replay it.",
            );
          return true;
        }
        await tx.buildApiCall.upsert({
          where,
          create: {
            packageId: packet.id,
            phase: scope.run.buildPhase ?? "execute",
            stepId: step.id,
            runId,
          },
          update: { runId, state: "executing", completedAt: null },
        });
        await tx.buildWorkPackage.update({
          where: { id: packet.id },
          data: { toolCalls: { increment: 1 } },
        });
        return false;
      });
      if (prior) continue;
      const executionId = `${runId}:${step.id}`;
      const auditTarget = {
        spaceId: scope.run.spaceId,
        threadId: scope.run.threadId,
        botId: scope.run.botId,
        runId,
      };
      await deps.events.append({
        ...auditTarget,
        type: "agent.tool.called",
        payload: {
          name: "build_api_step",
          executionId,
          stepId: step.id,
          method: step.request.method,
        },
      });
      const startedAt = Date.now();
      const result = (await requestWithBotSecret({
        prisma: deps.prisma,
        secretStore: deps.secretStore,
        scope: scope.run,
        request: step.request,
        signal: AbortSignal.timeout(30_000),
        remote: deps.secretHttp,
      })) as { status?: number; body?: unknown; truncated?: boolean; error?: string };
      await deps.events.append({
        ...auditTarget,
        type: "agent.tool.completed",
        payload: {
          name: "build_api_step",
          executionId,
          stepId: step.id,
          method: step.request.method,
          durationMs: Date.now() - startedAt,
          status: result.status ?? null,
          outcome:
            !result.error &&
            result.status &&
            result.status >= 200 &&
            result.status < 300 &&
            !result.truncated
              ? "succeeded"
              : "error",
        },
      });
      if (
        result.error ||
        !result.status ||
        result.status < 200 ||
        result.status >= 300 ||
        result.truncated
      )
        throw new Error(
          `Approved API step ${step.id} failed or returned incomplete data. Review saved state before retrying.`,
        );
      results.set(step.id, result.body);
      await deps.prisma.buildApiCall.update({
        where: {
          packageId_phase_stepId: {
            packageId: scope.packet.id,
            phase: scope.run.buildPhase ?? "execute",
            stepId: step.id,
          },
        },
        data: { state: "completed", completedAt: new Date() },
      });
    }
    const checks = scope.definition.checks.map((check) => {
      const value = readJsonPointer(results.get(check.responseStep!), check.jsonPointer!);
      const actual = typeof value === "string" ? value : JSON.stringify(value);
      return {
        id: check.id,
        source: check.source,
        expected: check.expected,
        actual: actual ?? null,
        matched: actual !== undefined && actual === check.expected,
      };
    });
    const matched = checks.every((check) => check.matched);
    const receipt = await deps.prisma.buildWorkPackage.updateMany({
      where: {
        id: scope.packet.id,
        activeRunId: runId,
        build: { status: "running" },
        runs: { some: { id: runId, status: "running", leaseFence: fence } },
      },
      data: {
        receiptRunId: matched ? runId : null,
        evidence: {
          runId,
          phase: scope.run.buildPhase,
          checks,
          observedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    if (!receipt.count) throw new Error("Build changed during API verification.");
    if (!matched)
      throw new Error(
        `API read-back did not match approved checks: ${checks
          .filter((check) => !check.matched)
          .map((check) => check.id)
          .join(", ")}.`,
      );
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "API package stopped.";
  }
  await deps.events.finalizeRun({
    spaceId: scope.run.spaceId,
    threadId: scope.run.threadId,
    botId: scope.run.botId,
    runId,
    taskId: scope.run.taskId,
    attemptId: attempt.id,
    leaseOwner: workerId,
    leaseFence: fence,
    ...(error
      ? { outcome: "failed" as const, error }
      : {
          outcome: "completed" as const,
          blocks: [
            {
              kind: "text" as const,
              text: `${scope.packet.title}: ${scope.run.buildPhase === "verify" ? "independent API verification" : "API execution and read-back"} finished without model calls.`,
            },
          ],
          markUnread: true,
        }),
  });
  await finishBuildRun(deps, runId);
  return true;
}
