import { inferAttachmentMimeType } from "@rakazo/core";
import { describe, expect, it } from "vitest";
import { filterPickedAttachments } from "./pick-attachments-filter.js";

describe("filterPickedAttachments", () => {
  it("skips unsupported mime types and oversize files", () => {
    const result = filterPickedAttachments(0, [
      {
        name: "notes.txt",
        mimeType: "text/plain",
        size: 12,
        contentBase64: "aGVsbG8=",
      },
      {
        name: "evil.zip",
        mimeType: null,
        size: 12,
        contentBase64: "aGVsbG8=",
      },
      {
        name: "big.bin",
        mimeType: "text/plain",
        size: 11 * 1024 * 1024,
        contentBase64: "aGVsbG8=",
      },
    ]);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.name).toBe("notes.txt");
    expect(result.skipped.map((item) => item.name)).toEqual(["evil.zip", "big.bin"]);
  });

  it.each([
    ["budget.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["budget.xls", "application/vnd.ms-excel"],
  ])("accepts %s from the document picker with a generic MIME type", (name, mimeType) => {
    const result = filterPickedAttachments(0, [
      {
        name,
        mimeType: inferAttachmentMimeType(name, "application/octet-stream"),
        size: 4,
        contentBase64: "AAECAw==",
      },
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.attachments).toEqual([
      expect.objectContaining({ name, mimeType, contentBase64: "AAECAw==" }),
    ]);
  });

  it("assigns distinct ids to duplicate files", () => {
    const candidate = {
      name: "notes.txt",
      mimeType: "text/plain",
      size: 12,
      contentBase64: "aGVsbG8=",
    };
    const result = filterPickedAttachments(0, [candidate, candidate]);
    expect(result.attachments.map((attachment) => attachment.id)).toEqual([
      "notes.txt-12-0",
      "notes.txt-12-1",
    ]);
  });
});
