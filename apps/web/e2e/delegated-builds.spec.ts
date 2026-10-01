import { expect, test } from "@playwright/test";
import { completeOnboarding, createNamedBot, openUserSettings, rpc, signup } from "./helpers";

test("reviewed manifests expose a shared budget, require start approval and report blockers without false completion", async ({
  page,
}) => {
  await signup(page, `build-ui-${Date.now()}@rakazo.test`, "password12", "Build UI Fixture");
  await completeOnboarding(page);
  const chief = await createNamedBot(page, "Build Coordinator");
  const worker = await createNamedBot(page, "Build Specialist");
  const qa = await createNamedBot(page, "Build Verifier");
  for (const botId of [chief, worker, qa]) await rpc(page, "threads/stop", { botId });
  await openUserSettings(page, "builds");
  const panel = page.getByTestId("build-settings");
  await expect(panel).toContainText("not subscription charges");
  await expect(panel).toContainText("Workbook-to-manifest compilation is not yet automatic");
  await panel.getByText("Create a scoped build", { exact: true }).click();
  await panel.getByLabel("Build manifest JSON").fill(
    JSON.stringify({
      title: "Budgeted fixture",
      coordinatorId: chief,
      browserOwnerId: chief,
      targetUrl: "https://fixture.example/event?evtstub=approved",
      targetIdentity: "Fixture Event",
      maxMicrousd: 80_000_000,
      packages: [
        {
          key: "fee",
          title: "Read fee",
          agentId: worker,
          verifierId: qa,
          kind: "api",
          instructions: "Read the approved fixture fee only.",
          apiSteps: [
            {
              id: "read",
              request: {
                name: "missing-fixture-token",
                method: "GET",
                url: "https://fixture.example/api/event",
              },
            },
          ],
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
    }),
  );
  await panel.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(panel.getByTestId("build-status")).toHaveText("draft");
  await expect(panel).toContainText("Ceiling: $80.00");
  const start = panel.getByRole("button", { name: "Start approved build", exact: true });
  await expect(start).toBeDisabled();
  await panel.getByRole("checkbox").check();
  await start.click();
  await expect(panel.getByTestId("build-status")).toHaveText("paused", { timeout: 15_000 });
  await expect(panel).toContainText("blocked");
  await expect(panel).toContainText("Spent: $0.00");
  await expect(panel.getByRole("button", { name: "Verify saved values only" })).toBeDisabled();
  await panel
    .getByLabel("Build review note")
    .fill("Review missing fixture credential before retrying.");
  await expect(panel.getByRole("button", { name: "Verify saved values only" })).toBeEnabled();
  await page.getByRole("button", { name: "Close user settings", exact: true }).click();
  await openUserSettings(page, "builds");
  await expect(panel.getByTestId("build-status")).toHaveText("paused");
});
