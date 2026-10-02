import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillMd, skillContentProblem, skillFiles } from "@rakazo/core";
import { describe, expect, it } from "vitest";

const teamDir = fileURLToPath(new URL("../../../docs/cvent-team/", import.meta.url));
const skillsDir = path.join(teamDir, "skills");
const skillDocs = readdirSync(skillsDir).filter((file) => file.endsWith(".md"));
const skillNames = new Set(skillDocs.map((file) => file.replace(/\.md$/, "")));

describe("cvent build skill", () => {
  it.each(skillDocs)("%s imports as a valid skill", (file) => {
    const content = readFileSync(path.join(skillsDir, file), "utf8");
    const parsed = parseSkillMd(content);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.name).toBe(file.replace(/\.md$/, ""));
    expect(parsed.name.length).toBeLessThanOrEqual(80);
    expect(parsed.description.length).toBeLessThanOrEqual(2000);
    expect(skillContentProblem(content)).toBeUndefined();
  });

  it("only references skills that exist", () => {
    const sources = [
      readFileSync(path.join(teamDir, "bots.json"), "utf8"),
      ...skillDocs.map((file) => readFileSync(path.join(skillsDir, file), "utf8")),
    ];
    const referenced = new Set(
      sources.flatMap((text) => text.match(/(?<![\w.-])\/cvent-[a-z-]+/g) ?? []),
    );
    for (const ref of referenced) expect(skillNames, ref).toContain(ref.slice(1));
  });

  it("carries its versioned tools as installable files", () => {
    const files = skillFiles(readFileSync(path.join(skillsDir, "cvent-build.md"), "utf8"));
    const byName = new Map(files.map((file) => [path.posix.basename(file.path), file]));
    expect([...byName.keys()].sort()).toEqual(["cvent_pw.py", "rr.py"]);
    for (const file of files) expect(file.path).toMatch(/^shared\/cvent-builds\/tools\//);
    expect(byName.get("rr.py")?.content).toMatch(/^PARSER_VERSION = \d+$/m);
    expect(byName.get("cvent_pw.py")?.content).toMatch(/^PW_VERSION = \d+$/m);
  });
});
