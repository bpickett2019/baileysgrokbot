import { expect, test } from "@playwright/test";
import type { ThreadSnapshot } from "@rakazo/contracts";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

const workbooks = [
  {
    name: "budget.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    // Binary payloads exercise upload/download transport, not workbook parsing.
    buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 255, 128, 1]),
  },
  {
    name: "legacy.xls",
    mimeType: "application/vnd.ms-excel",
    buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 255]),
  },
];

test("uploads Excel workbooks through the composer and preserves downloadable bytes", async ({
  page,
}, testInfo) => {
  await signup(page, `excel-${Date.now()}@rakazo.test`, "password12", "Excel Test");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  const composer = page.getByRole("combobox", { name: /Message/ });
  await expect(composer).toBeVisible();
  const input = page.getByTestId("composer-bar").locator('input[type="file"]');
  const accept = (await input.getAttribute("accept"))?.split(",");
  for (const workbook of workbooks) {
    expect(accept).toContain(workbook.mimeType);
    expect(accept).toContain(workbook.name.endsWith(".xlsx") ? ".xlsx" : ".xls");
  }
  await input.setInputFiles(
    workbooks.map((workbook) => ({ ...workbook, mimeType: "application/octet-stream" })),
  );
  for (const workbook of workbooks) {
    await expect(page.getByRole("button", { name: `Remove ${workbook.name}` })).toBeVisible();
  }
  await captureScreenshot(page, testInfo, "excel-attachments-selected");

  // Attachment-only messages should work without requiring a caption.
  await page.getByRole("button", { name: "Send", exact: true }).click();
  for (const workbook of workbooks) {
    await expect(
      page.getByTestId("transcript").getByText(workbook.name, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: `Remove ${workbook.name}` })).toHaveCount(0);
  }
  const snapshot = await rpc<ThreadSnapshot>(page, "threads/get", { botId });
  const blocks = snapshot.messages
    .filter((message) => message.role === "user")
    .flatMap((message) => message.blocks);
  for (const workbook of workbooks) {
    const block = blocks.find((item) => item.kind === "file" && item.name === workbook.name);
    expect(block).toMatchObject({
      kind: "file",
      mimeType: workbook.mimeType,
      size: workbook.buffer.length,
    });
    if (block?.kind !== "file") throw new Error(`Missing attachment: ${workbook.name}`);
    const downloaded = await rpc<{ contentBase64: string; mimeType: string }>(
      page,
      "artifacts/get",
      {
        botId,
        artifactId: block.artifactId,
      },
    );
    expect(downloaded.mimeType).toBe(workbook.mimeType);
    expect(Buffer.from(downloaded.contentBase64, "base64")).toEqual(workbook.buffer);
  }
  await page.reload();
  for (const workbook of workbooks) {
    await expect(
      page.getByTestId("transcript").getByText(workbook.name, { exact: true }),
    ).toBeVisible();
  }
  await captureScreenshot(page, testInfo, "excel-attachments-sent");
});
