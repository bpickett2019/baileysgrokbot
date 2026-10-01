import { describe, expect, it } from "vitest";
import { BuildManifest, BuildPackage } from "./builds.js";

const packet = {
  key: "registration",
  title: "Registration",
  agentId: "specialist",
  verifierId: "qa",
  instructions: "Set the approved fee.",
  checks: [{ id: "fee", source: "Fixture!B2", label: "Fee", expected: "25" }],
};
const manifest = {
  title: "Fixture build",
  coordinatorId: "chief",
  browserOwnerId: "chief",
  targetUrl: "https://fixture.example/event?evtstub=approved",
  targetIdentity: "Fixture Event",
  packages: [packet],
};

describe("approved build contracts", () => {
  it("defaults to an eighty-dollar API-equivalent ceiling and bounded calls", () => {
    const parsed = BuildManifest.parse(manifest);
    expect(parsed.maxMicrousd).toBe(80_000_000);
    expect(parsed.packages[0]?.maxModelCalls).toBe(30);
    expect(parsed.packages[0]?.maxToolCalls).toBe(60);
  });
  it.each([
    { ...manifest, maxMicrousd: 100_000_001 },
    { ...manifest, targetUrl: "http://fixture.example/event" },
    { ...manifest, packages: [{ ...packet, agentId: "chief" }] },
    { ...manifest, packages: [{ ...packet, verifierId: "chief" }] },
    { ...manifest, packages: [{ ...packet, verifierId: "specialist" }] },
    { ...manifest, packages: [{ ...packet, dependsOn: ["missing"] }] },
    { ...manifest, packages: [{ ...packet, dependsOn: ["registration"] }] },
    { ...manifest, packages: [packet, packet] },
    { ...manifest, packages: [{ ...packet, readbackUrl: "https://different.example/event" }] },
    { ...manifest, targetQueryKeys: ["missing"] },
  ])("rejects unsafe or contradictory manifests %#", (input) =>
    expect(BuildManifest.safeParse(input).success).toBe(false),
  );
  it("rejects a multi-package dependency cycle", () => {
    expect(
      BuildManifest.safeParse({
        ...manifest,
        packages: [
          { ...packet, dependsOn: ["questions"] },
          { ...packet, key: "questions", dependsOn: ["registration"] },
        ],
      }).success,
    ).toBe(false);
  });
  it("requires independent API GET read-back and forbids DELETE", () => {
    const api = {
      ...packet,
      kind: "api",
      apiSteps: [
        {
          id: "read",
          request: {
            name: "fixture-token",
            method: "GET",
            url: "https://fixture.example/api/item",
          },
        },
      ],
      checks: [{ ...packet.checks[0], responseStep: "read", jsonPointer: "/fee" }],
    };
    expect(BuildPackage.safeParse(api).success).toBe(true);
    expect(BuildPackage.safeParse({ ...api, checks: packet.checks }).success).toBe(false);
    expect(BuildPackage.safeParse({ ...api, maxToolCalls: 1 }).success).toBe(false);
    expect(
      BuildPackage.safeParse({
        ...api,
        apiSteps: [
          { ...api.apiSteps[0], request: { ...api.apiSteps[0]!.request, method: "DELETE" } },
        ],
      }).success,
    ).toBe(false);
  });
});
