import { z } from "zod";
import { SecretHttpRequest } from "./bot-secrets.js";

const browserUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Use an HTTPS URL without credentials");
const forbiddenOperation =
  /(?:^|[/?&=_-])(delete|remove|publish|activate|send|schedule|clone)(?:$|[/?&=_-])/i;

export const BuildCheck = z.object({
  id: z.string().min(1).max(80),
  source: z.string().min(1).max(300),
  label: z.string().min(1).max(200),
  role: z.string().max(80).optional(),
  expected: z.string().max(4000),
  responseStep: z.string().max(80).optional(),
  jsonPointer: z.string().max(300).optional(),
});

export const BuildPackage = z
  .object({
    key: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    title: z.string().min(1).max(160),
    agentId: z.string().min(1),
    verifierId: z.string().min(1),
    dependsOn: z.array(z.string()).max(100).default([]),
    instructions: z.string().min(1).max(6000),
    kind: z.enum(["browser", "api"]).default("browser"),
    readbackUrl: browserUrl.optional(),
    allowedClicks: z.array(z.string().min(1).max(200)).max(30).default([]),
    apiSteps: z
      .array(
        z.object({
          id: z.string().min(1).max(80),
          request: SecretHttpRequest.refine((request) => {
            try {
              const url = new URL(request.url);
              return (
                ["GET", "POST", "PUT"].includes(request.method) &&
                !forbiddenOperation.test(decodeURIComponent(`${url.pathname}${url.search}`))
              );
            } catch {
              return false;
            }
          }, "Only scoped read/create/update requests are allowed; destructive and publication endpoints are blocked"),
        }),
      )
      .max(200)
      .default([]),
    checks: z.array(BuildCheck).min(1).max(30),
    maxModelCalls: z.number().int().min(1).max(100).default(30),
    maxToolCalls: z.number().int().min(1).max(200).default(60),
    maxMicrousd: z.number().int().min(1).max(100_000_000).default(10_000_000),
  })
  .superRefine((packet, ctx) => {
    if (
      packet.kind === "api" &&
      (!packet.apiSteps.length ||
        packet.checks.some(
          (check) =>
            !packet.apiSteps.some(
              (step) => step.id === check.responseStep && step.request.method === "GET",
            ) || check.jsonPointer === undefined,
        ))
    )
      ctx.addIssue({
        code: "custom",
        message: "API checks require an explicit GET read-back step and JSON pointer.",
      });
    if (
      packet.kind === "api" &&
      packet.apiSteps.length +
        packet.apiSteps.filter((step) => step.request.method === "GET").length >
        packet.maxToolCalls
    )
      ctx.addIssue({
        code: "custom",
        message: "API execution and independent read-back must fit the tool-call allowance.",
      });
    if (
      packet.checks.some(
        (check) =>
          check.jsonPointer !== undefined &&
          check.jsonPointer !== "" &&
          !check.jsonPointer.startsWith("/"),
      )
    )
      ctx.addIssue({ code: "custom", message: "Invalid JSON pointer." });
    if (new Set(packet.apiSteps.map((step) => step.id)).size !== packet.apiSteps.length)
      ctx.addIssue({ code: "custom", message: "API step identifiers must be unique." });
    if (packet.kind === "browser" && packet.apiSteps.length)
      ctx.addIssue({ code: "custom", message: "Browser packages cannot contain API requests." });
    if (packet.agentId === packet.verifierId)
      ctx.addIssue({ code: "custom", message: "Verification requires a different agent." });
    if (new Set(packet.checks.map((check) => check.id)).size !== packet.checks.length)
      ctx.addIssue({ code: "custom", message: "Check identifiers must be unique." });
  });

/** An operator-approved manifest, not instructions extracted from an untrusted web page. */
export const BuildManifest = z
  .object({
    title: z.string().min(1).max(160),
    coordinatorId: z.string().min(1),
    browserOwnerId: z.string().min(1),
    targetUrl: browserUrl,
    targetIdentity: z.string().min(1).max(300),
    targetQueryKeys: z.array(z.string().min(1).max(80)).max(8).default([]),
    instructions: z.string().max(4000).default(""),
    maxMicrousd: z.number().int().min(1).max(100_000_000).default(80_000_000),
    maxInputTokens: z.number().int().min(1).max(100_000_000).default(10_000_000),
    maxOutputTokens: z.number().int().min(1).max(2_000_000).default(500_000),
    maxPromptChars: z.number().int().min(4000).max(100_000).default(60_000),
    maxOutputPerCall: z.number().int().min(1024).max(16_384).default(4096),
    packages: z.array(BuildPackage).min(1).max(200),
  })
  .superRefine((manifest, ctx) => {
    if (manifest.targetQueryKeys.some((key) => !new URL(manifest.targetUrl).searchParams.has(key)))
      ctx.addIssue({
        code: "custom",
        message: "Target identity parameters must exist in the approved URL.",
      });
    const packets = new Map(manifest.packages.map((packet) => [packet.key, packet]));
    if (packets.size !== manifest.packages.length)
      ctx.addIssue({ code: "custom", message: "Package keys must be unique." });
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (key: string): boolean => {
      if (visited.has(key)) return true;
      const packet = packets.get(key);
      if (!packet || visiting.has(key)) return false;
      visiting.add(key);
      for (const dependency of packet.dependsOn) if (!visit(dependency)) return false;
      visiting.delete(key);
      visited.add(key);
      return true;
    };
    for (const packet of manifest.packages) {
      if (
        manifest.packages.length > 1 &&
        packet.kind === "api" &&
        packet.apiSteps.length +
          2 * packet.apiSteps.filter((step) => step.request.method === "GET").length >
          packet.maxToolCalls
      )
        ctx.addIssue({
          code: "custom",
          message:
            "API execution, independent verification and final read-back must fit the tool allowance.",
        });
      if (
        packet.readbackUrl &&
        new URL(packet.readbackUrl).origin !== new URL(manifest.targetUrl).origin
      )
        ctx.addIssue({
          code: "custom",
          message: "Read-back must use the approved browser origin.",
        });
      if ([packet.agentId, packet.verifierId].includes(manifest.coordinatorId))
        ctx.addIssue({
          code: "custom",
          message: "The coordinator cannot execute or verify packages.",
        });
      if (!visit(packet.key)) {
        ctx.addIssue({
          code: "custom",
          message: "Dependencies must exist and must not form a cycle.",
        });
        break;
      }
    }
  });
export type BuildManifestInput = z.infer<typeof BuildManifest>;

export const BuildView = z.object({
  manifest: BuildManifest,
  finalVerification: z.boolean(),
  id: z.string(),
  title: z.string(),
  status: z.string(),
  reason: z.string().nullable(),
  coordinatorId: z.string(),
  browserOwnerId: z.string(),
  activeAgentId: z.string().nullable(),
  maxMicrousd: z.number(),
  spentMicrousd: z.number(),
  reservedMicrousd: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  modelCalls: z.number(),
  packages: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      agentId: z.string(),
      verifierId: z.string(),
      status: z.string(),
      phase: z.string(),
      runId: z.string().nullable(),
      modelCalls: z.number(),
      toolCalls: z.number(),
      spentMicrousd: z.number(),
      reason: z.string().nullable(),
    }),
  ),
});
export const BuildSummary = BuildView.omit({ manifest: true });
