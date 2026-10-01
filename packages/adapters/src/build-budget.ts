import { randomUUID } from "node:crypto";
import type { ModelCallAccounting, ModelCallGuard } from "@rakazo/adapter-kit";
import type { Prisma, PrismaClient } from "@rakazo/db";
import { buildRunScope, lockBuild } from "./agent-builds.js";

type Rates = Parameters<ModelCallGuard["reserve"]>[0]["rates"];

/** Catalog USD/million tokens is numerically equal to micro-USD/token. */
export function modelUsageMicrousd(usage: ModelCallAccounting, rates: Rates) {
  const counts = [
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens,
  ];
  if (
    counts.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    usage.cacheReadTokens + usage.cacheWriteTokens > usage.inputTokens
  )
    throw new Error("Invalid model usage; reservation retained.");
  return Math.ceil(
    (usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens) * rates.input +
      usage.outputTokens * rates.output +
      usage.cacheReadTokens * rates.cacheRead +
      usage.cacheWriteTokens * rates.cacheWrite,
  );
}

export async function createBuildModelGuard(
  prisma: PrismaClient,
  runId: string,
): Promise<ModelCallGuard | undefined> {
  const scope = await buildRunScope(prisma, runId);
  if (!scope) return undefined;
  return {
    maxPromptChars: scope.manifest.maxPromptChars,
    async reserve(request) {
      if (
        Object.values(request.rates).some((rate) => !Number.isFinite(rate) || rate < 0) ||
        !Object.values(request.rates).some((rate) => rate > 0)
      )
        throw new Error("Build accounting requires known, nonzero model pricing.");
      if (
        ![request.maxInputTokens, request.maxOutputTokens].every(
          (count) => Number.isSafeInteger(count) && count > 0,
        )
      )
        throw new Error("Build accounting requires bounded model context and output.");
      const reserved = Math.ceil(
        request.maxInputTokens *
          Math.max(request.rates.input, request.rates.cacheRead, request.rates.cacheWrite) +
          request.maxOutputTokens * request.rates.output,
      );
      const id = randomUUID();
      const denied = await prisma.$transaction(async (tx) => {
        const build = await lockBuild(tx, scope.build.id);
        const packet = await tx.buildWorkPackage.findUniqueOrThrow({
          where: { id: scope.packet.id },
        });
        const activeRun = await tx.run.findUnique({
          where: { id: runId },
          select: { status: true, leaseFence: true, leaseOwner: true, leaseExpiresAt: true },
        });
        if (
          build.status !== "running" ||
          packet.status !== "running" ||
          packet.activeRunId !== runId ||
          activeRun?.status !== "running" ||
          !activeRun.leaseExpiresAt ||
          activeRun.leaseExpiresAt.getTime() <= Date.now() ||
          activeRun.leaseFence !== scope.run.leaseFence ||
          activeRun.leaseOwner !== scope.run.leaseOwner
        )
          return "Build is paused, stopped or reassigned.";
        let reason: string | undefined;
        if (packet.modelCalls >= scope.definition.maxModelCalls)
          reason = "Package model-call allowance reached.";
        else if (
          build.spentMicrousd + build.reservedMicrousd + reserved > build.maxMicrousd ||
          packet.spentMicrousd + packet.reservedMicrousd + reserved > scope.definition.maxMicrousd
        )
          reason = "Insufficient build allowance for another safely reserved model request.";
        else if (
          build.inputTokens + build.reservedInputTokens + request.maxInputTokens >
            build.maxInputTokens ||
          build.outputTokens + build.reservedOutputTokens + request.maxOutputTokens >
            build.maxOutputTokens
        )
          reason = "Build token allowance reached.";
        if (reason) {
          await tx.agentBuild.update({
            where: { id: build.id },
            data: { status: "paused", reason },
          });
          return reason;
        }
        await tx.buildModelCall.create({
          data: {
            id,
            buildId: build.id,
            packageId: packet.id,
            runId,
            provider: request.provider,
            model: request.model,
            rates: request.rates,
            reservedMicrousd: reserved,
            reservedInputTokens: request.maxInputTokens,
            reservedOutputTokens: request.maxOutputTokens,
          },
        });
        await tx.agentBuild.update({
          where: { id: build.id },
          data: {
            modelCalls: { increment: 1 },
            reservedMicrousd: { increment: reserved },
            reservedInputTokens: { increment: request.maxInputTokens },
            reservedOutputTokens: { increment: request.maxOutputTokens },
          },
        });
        await tx.buildWorkPackage.update({
          where: { id: packet.id },
          data: { modelCalls: { increment: 1 }, reservedMicrousd: { increment: reserved } },
        });
        return undefined;
      });
      if (denied) throw new Error(denied);
      return { settle: (usage) => settleBuildModelCall(prisma, id, usage) };
    },
  };
}

export async function settleBuildModelCall(
  prisma: PrismaClient,
  id: string,
  usage: ModelCallAccounting | null,
) {
  const existing = await prisma.buildModelCall.findUniqueOrThrow({ where: { id } });
  await prisma.$transaction(async (tx) => {
    const build = await lockBuild(tx, existing.buildId);
    const call = await tx.buildModelCall.findUniqueOrThrow({ where: { id } });
    if (call.state !== "reserved") return;
    if (!usage) {
      await tx.buildModelCall.update({ where: { id }, data: { state: "uncertain" } });
      await tx.agentBuild.update({
        where: { id: build.id },
        data: {
          status: "paused",
          reason:
            "Model usage is uncertain. Its reservation remains held; review before continuing.",
        },
      });
      return;
    }
    const cost = modelUsageMicrousd(usage, call.rates as Rates);
    const exceeded =
      cost > call.reservedMicrousd ||
      usage.inputTokens > call.reservedInputTokens ||
      usage.outputTokens > call.reservedOutputTokens;
    await tx.buildModelCall.update({
      where: { id },
      data: {
        state: "settled",
        spentMicrousd: cost,
        usage: usage as unknown as Prisma.InputJsonValue,
        settledAt: new Date(),
      },
    });
    await tx.agentBuild.update({
      where: { id: build.id },
      data: {
        spentMicrousd: { increment: cost },
        reservedMicrousd: { decrement: call.reservedMicrousd },
        inputTokens: { increment: usage.inputTokens },
        outputTokens: { increment: usage.outputTokens },
        reservedInputTokens: { decrement: call.reservedInputTokens },
        reservedOutputTokens: { decrement: call.reservedOutputTokens },
        ...(exceeded
          ? {
              status: "paused",
              reason:
                "Provider usage exceeded the reserved bound. Review pricing/limits before proceeding.",
            }
          : {}),
      },
    });
    await tx.buildWorkPackage.update({
      where: { id: call.packageId },
      data: {
        spentMicrousd: { increment: cost },
        reservedMicrousd: { decrement: call.reservedMicrousd },
      },
    });
  });
}
