import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillMd } from "@rakazo/core";
import { describe, expect, it } from "vitest";

const teamDir = fileURLToPath(new URL("../../../docs/cvent-team/", import.meta.url));
const skillsDir = path.join(teamDir, "skills");
const skillFiles = readdirSync(skillsDir).filter((file) => file.endsWith(".md"));
const skillNames = new Set(skillFiles.map((file) => file.replace(/\.md$/, "")));

describe("cvent team skills", () => {
  it.each(skillFiles)("%s imports as a valid skill", (file) => {
    const content = readFileSync(path.join(skillsDir, file), "utf8");
    const parsed = parseSkillMd(content);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.name).toBe(file.replace(/\.md$/, ""));
    expect(parsed.name.length).toBeLessThanOrEqual(80);
    expect(parsed.description.length).toBeLessThanOrEqual(2000);
    expect(content.length).toBeLessThanOrEqual(100_000);
  });

  it("only references skills that exist", () => {
    const sources = [
      readFileSync(path.join(teamDir, "bots.json"), "utf8"),
      ...skillFiles.map((file) => readFileSync(path.join(skillsDir, file), "utf8")),
    ];
    const referenced = new Set(
      sources.flatMap((text) => text.match(/(?<![\w.-])\/cvent-[a-z-]+/g) ?? []),
    );
    for (const ref of referenced) expect(skillNames, ref).toContain(ref.slice(1));
  });

  it("embeds a versioned parser", () => {
    const parse = readFileSync(path.join(skillsDir, "cvent-rr-parse.md"), "utf8");
    expect(parse).toMatch(/```python\n[\s\S]*PARSER_VERSION = \d+[\s\S]*```/);
  });
});
