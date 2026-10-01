import { BuildManifest } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  advanceBuildObservation,
  assertBuildTarget,
  buildObservationFingerprint,
  buildPackagePrompt,
  serializeBuildToolCalls,
  snapshotCheckResults,
} from "./agent-builds.js";
import { readJsonPointer } from "./build-api-executor.js";
import { modelUsageMicrousd } from "./build-budget.js";

const manifest = BuildManifest.parse({
  title: "Fixture",
  coordinatorId: "chief",
  browserOwnerId: "chief",
  targetUrl: "https://fixture.example/event?evtstub=approved",
  targetIdentity: "Fixture Event",
  packages: [
    {
      key: "fee",
      title: "Fee",
      agentId: "worker",
      verifierId: "qa",
      instructions: "Set fee only.",
      checks: [{ id: "fee", label: "Fee", expected: "25", source: "Fixture!B2" }],
    },
  ],
});
const snapshot = {
  url: manifest.targetUrl,
  title: "Fixture Event",
  tree: "Fixture Event Fee",
  elements: [{ ref: "e1", role: "textbox", name: "Fee", value: "25" }],
};

describe("build safety helpers", () => {
  it("counts cache reads/writes inside input without double billing", () => {
    expect(
      modelUsageMicrousd(
        { inputTokens: 1000, outputTokens: 10, cacheReadTokens: 600, cacheWriteTokens: 300 },
        { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      ),
    ).toBe(2220);
    expect(() =>
      modelUsageMicrousd(
        { inputTokens: 1, outputTokens: 0, cacheReadTokens: 2, cacheWriteTokens: 0 },
        { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      ),
    ).toThrow();
  });
  it("requires the approved name, origin and event identifier", () => {
    expect(() => assertBuildTarget(manifest, snapshot)).not.toThrow();
    expect(() =>
      assertBuildTarget(manifest, {
        ...snapshot,
        url: "https://fixture.example/event?evtstub=other",
      }),
    ).toThrow();
    expect(() =>
      assertBuildTarget(manifest, {
        ...snapshot,
        url: "https://other.example/event?evtstub=approved",
      }),
    ).toThrow();
    expect(() =>
      assertBuildTarget(manifest, { ...snapshot, title: "Other", tree: "Other" }),
    ).toThrow();
    expect(() => assertBuildTarget(manifest, { ...snapshot, fallback: "computer_act" })).toThrow();
  });
  it("requires exact, unambiguous field read-back", () => {
    expect(snapshotCheckResults(snapshot, manifest.packages[0]!)[0]?.matched).toBe(true);
    expect(
      snapshotCheckResults(
        { ...snapshot, elements: [...snapshot.elements, ...snapshot.elements] },
        manifest.packages[0]!,
      )[0]?.matched,
    ).toBe(false);
    expect(
      snapshotCheckResults(
        { ...snapshot, elements: [{ ...snapshot.elements[0]!, value: "250" }] },
        manifest.packages[0]!,
      )[0]?.matched,
    ).toBe(false);
  });
  it("ignores changing element refs when detecting repeated observations", () => {
    expect(buildObservationFingerprint(snapshot)).toBe(
      buildObservationFingerprint({
        ...snapshot,
        elements: [{ ...snapshot.elements[0], ref: "new-ref" }],
      }),
    );
    expect(buildObservationFingerprint(snapshot)).not.toBe(
      buildObservationFingerprint({
        ...snapshot,
        elements: [{ ...snapshot.elements[0], value: "30" }],
      }),
    );
  });
  it("sends only the current package, not the other specialists' payloads", () => {
    const second = {
      ...manifest.packages[0]!,
      key: "other",
      instructions: "UNRELATED_INSTRUCTIONS",
    };
    const prompt = buildPackagePrompt(
      { ...manifest, packages: [...manifest.packages, second] },
      manifest.packages[0],
      "verify",
    );
    expect(prompt).toContain('"phase":"verify"');
    expect(prompt).not.toContain("UNRELATED_INSTRUCTIONS");
  });
  it("detects alternating no-progress observations, not just identical consecutive tools", () => {
    let state: { lastObservation: string | null; repeatedObservations: number } = {
      lastObservation: null,
      repeatedObservations: 0,
    };
    for (const fingerprint of ["A", "B", "A", "B", "A"])
      state = advanceBuildObservation(
        state.lastObservation,
        state.repeatedObservations,
        fingerprint,
      );
    expect(state.repeatedObservations).toBe(3);
    expect(
      advanceBuildObservation(state.lastObservation, state.repeatedObservations, "new saved values")
        .repeatedObservations,
    ).toBe(0);
  });
  it("serializes verification and edits and recovers the queue after a rejected tool", async () => {
    let active = 0;
    let maximum = 0;
    const run = serializeBuildToolCalls(async (fail: boolean) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      if (fail) throw new Error("fixture failure");
      return "ok";
    });
    const results = await Promise.allSettled([run(true), run(false), run(false)]);
    expect(maximum).toBe(1);
    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled", "fulfilled"]);
  });
  it("reads escaped JSON pointers without inherited-property traversal", () => {
    expect(readJsonPointer({ "a/b": { "~c": [25] } }, "/a~1b/~0c/0")).toBe(25);
    expect(readJsonPointer({}, "/constructor")).toBeUndefined();
    expect(() => readJsonPointer({}, "invalid")).toThrow();
  });
});
