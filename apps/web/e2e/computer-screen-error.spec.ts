import { expect, test } from "@playwright/test";
import type { ThreadSnapshot } from "@rakazo/contracts";
import {
  activeBotId,
  captureScreenshot,
  completeOnboarding,
  createNamedBot,
  isRealSandboxProvider,
  rpc,
  signup,
} from "./helpers";

for (const expanded of [false, true]) {
  test(`open ${expanded ? "full screen" : "preview"} renews its screen URL when a run starts`, async ({
    page,
  }, testInfo) => {
    test.skip(isRealSandboxProvider(), "Uses the offline scripted runtime");
    await signup(
      page,
      `screen-resume-${expanded}-${Date.now()}@rakazo.test`,
      "password12",
      "Screen Resume",
    );
    await completeOnboarding(page);
    const botId = activeBotId(page);
    await expect
      .poll(async () => {
        const thread = await rpc<{ run?: { status: string } }>(page, "threads/get", { botId });
        return !thread.run || ["completed", "cancelled", "failed"].includes(thread.run.status);
      })
      .toBe(true);
    await rpc(page, "computer/boot", { botId });

    let generation = "before-run";
    await page.route("https://screen.example/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><title>Test desktop</title><body style="background:Canvas;color:CanvasText"><p>Desktop ${new URL(route.request().url()).searchParams.get("generation")}</p>`,
      }),
    );
    await page.route("**/rpc/computer/screenUrl", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          json: { url: `https://screen.example/vnc.html?generation=${generation}` },
        }),
      }),
    );
    await page.getByTitle("Agent computer").click();
    const preview = page.getByTestId("computer-preview");
    await expect(preview.locator("iframe")).toHaveAttribute("src", /generation=before-run/);
    if (expanded) {
      await preview.hover();
      await preview.getByTestId("computer-preview-open").click();
      await expect(page.getByRole("button", { name: "Close computer" })).toBeVisible();
      // Release through RPC without closing the viewer, as a separate client can do.
      await rpc(page, "computer/release", { botId, reason: "done" });
    }
    const frame = expanded ? page.locator('iframe[title="Bot screen"]') : preview.locator("iframe");
    await expect(frame).toHaveAttribute("src", /generation=before-run/);
    generation = "resumed-run";
    try {
      // A backend-triggered run bypasses the composer's refreshThread path. Keep it
      // running so a terminal-event refresh cannot accidentally make this test pass.
      await rpc(page, "threads/send", { botId, text: "keep working until I stop you" });
      await expect
        .poll(async () => {
          const thread = await rpc<{ run?: { status: string } }>(page, "threads/get", { botId });
          return thread.run?.status;
        })
        .toBe("running");
      await expect(frame).toHaveAttribute("src", /generation=resumed-run/);
      await expect(frame.contentFrame().getByText("Desktop resumed-run")).toBeVisible();
      await captureScreenshot(page, testInfo, `screen-resumed-${expanded ? "full" : "preview"}`);
    } finally {
      await rpc(page, "threads/stop", { botId });
    }
  });
}

test("group viewer renews the displayed member's screen when its run starts", async ({
  page,
}, testInfo) => {
  test.skip(isRealSandboxProvider(), "Uses the offline scripted runtime");
  await signup(page, `group-screen-resume-${Date.now()}@rakazo.test`, "password12", "Group Screen");
  await completeOnboarding(page);
  const chiefId = activeBotId(page);
  const botId = await createNamedBot(page, "Viewer");
  await expect
    .poll(async () => {
      const thread = await rpc<{ run?: { status: string } }>(page, "threads/get", { botId });
      return !thread.run || ["completed", "cancelled", "failed"].includes(thread.run.status);
    })
    .toBe(true);
  await rpc(page, "computer/boot", { botId });
  const group = await rpc<{ id: string }>(page, "groups/create", {
    name: "Screen team",
    botIds: [chiefId, botId],
  });
  await page.route("**/rpc/threads/get", async (route) => {
    if (!route.request().postData()?.includes(group.id)) return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    body.json.messages.push({
      id: "group-screen-card",
      threadId: body.json.threadId,
      seq: body.json.cursor + 1,
      role: "bot",
      botId,
      createdAt: new Date().toISOString(),
      blocks: [{ kind: "computer", state: "Needs you", text: "Open this member's screen." }],
    });
    await route.fulfill({ response, body: JSON.stringify(body) });
  });
  let generation = "before-run";
  await page.route("https://screen.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>Group desktop</title><body style="background:Canvas;color:CanvasText"><p>Member screen ${new URL(route.request().url()).searchParams.get("generation")}</p>`,
    }),
  );
  await page.route("**/rpc/computer/screenUrl", (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ json: { botId } });
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        json: { url: `https://screen.example/vnc.html?generation=${generation}` },
      }),
    });
  });
  await page.goto(`/app/g/${group.id}`);
  await page.getByTestId("computer-card-open").click();
  const frame = page.locator('iframe[title="Bot screen"]');
  await expect(frame).toHaveAttribute("src", /generation=before-run/);
  await rpc(page, "computer/release", { botId, reason: "done" });
  generation = "resumed-run";
  try {
    await rpc(page, "threads/send", {
      groupId: group.id,
      mentions: [botId],
      text: "keep working until I stop you",
    });
    await expect
      .poll(async () => {
        const thread = await rpc<ThreadSnapshot>(page, "threads/get", { groupId: group.id });
        return thread.activeRuns?.some((run) => run.botId === botId && run.status === "running");
      })
      .toBe(true);
    await expect(frame).toHaveAttribute("src", /generation=resumed-run/);
    await expect(frame.contentFrame().getByText("Member screen resumed-run")).toBeVisible();
    await captureScreenshot(page, testInfo, "group-screen-resumed");
  } finally {
    await rpc(page, "threads/stop", { groupId: group.id });
  }
});

test("screen connection failures stay visible and can be retried", async ({ page }, testInfo) => {
  await signup(page, `screen-error-${Date.now()}@rakazo.test`, "password12", "Screen Error");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  await rpc(page, "computer/boot", { botId });
  await expect(rpc<{ state: string }>(page, "computer/status", { botId })).resolves.toMatchObject({
    state: "running",
  });

  let failScreen = true;
  const screenUrl = "https://screen.example/vnc.html";
  await page.route("https://screen.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Test desktop</title><p>Desktop connected</p>",
    }),
  );
  await page.route("**/rpc/computer/screenUrl", (route) =>
    route.fulfill({
      status: failScreen ? 409 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        failScreen
          ? {
              json: {
                defined: false,
                code: "CONFLICT",
                status: 409,
                message:
                  "The computer screen is temporarily busy. Retry in a moment. File and shell tools still work.",
              },
            }
          : { json: { url: screenUrl } },
      ),
    }),
  );

  await page.getByTitle("Agent computer").click();
  const preview = page.getByTestId("computer-preview");
  await expect(preview.getByRole("alert")).toContainText("temporarily busy");
  await expect(preview.getByTestId("computer-preview-open")).toHaveCount(0);
  await captureScreenshot(page, testInfo, "computer-screen-connection-error");

  failScreen = false;
  await preview.getByRole("button", { name: "Retry screen" }).click();
  await expect(preview.locator("iframe")).toHaveAttribute("src", screenUrl);
  await expect(preview.getByRole("alert")).toHaveCount(0);

  failScreen = true;
  await preview.hover();
  await preview.getByTestId("computer-preview-open").click();
  await expect(page.getByRole("button", { name: "Close computer" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("temporarily busy");
  await captureScreenshot(page, testInfo, "computer-full-screen-connection-error");

  failScreen = false;
  await page.getByRole("button", { name: "Retry screen" }).click();
  await expect(page.locator('iframe[title="Bot screen"]')).toHaveAttribute("src", screenUrl);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
