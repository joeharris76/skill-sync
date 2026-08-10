import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { COMMANDS, VERSION } from "../../../src/cli/index.js";
import { KNOWN_FLAGS } from "../../../src/cli/parse.js";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const skillRoot = join(projectRoot, "skills", "skill-sync");

function versionTuple(version: string): number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10));
}

function isAtLeast(actual: string, minimum: string): boolean {
  const left = versionTuple(actual);
  const right = versionTuple(minimum);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

describe("packaged skill-sync operator contract", () => {
  it("documents every CLI command and recognized flag", async () => {
    const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8");

    for (const command of Object.keys(COMMANDS)) {
      expect(skill).toContain(`\`${command}\``);
    }
    for (const flag of Object.keys(KNOWN_FLAGS)) {
      expect(skill).toContain(`--${flag}`);
    }
  });

  it("declares a supported CLI version", async () => {
    const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
    const descriptor = parseYaml(await readFile(join(skillRoot, "skill.yaml"), "utf8"));
    const minimum = descriptor.compatibility["skill-sync"].min_version;

    expect(VERSION).toBe(packageJson.version);
    expect(isAtLeast(packageJson.version, minimum)).toBe(true);
  });

  it("packages every referenced operator file", async () => {
    const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8");
    const references = [...skill.matchAll(/`(references\/[^`]+\.md)`/g)].map((match) => match[1]!);
    const { stdout } = await execFileAsync(
      "npm",
      ["pack", "--dry-run", "--json", "--ignore-scripts"],
      { cwd: projectRoot },
    );
    const [{ files }] = JSON.parse(stdout) as [{ files: Array<{ path: string }> }];
    const packed = new Set(files.map((file) => file.path));

    expect(packed).toContain("skills/skill-sync/SKILL.md");
    expect(packed).toContain("skills/skill-sync/skill.yaml");
    for (const reference of references) {
      expect(packed).toContain(`skills/skill-sync/${reference}`);
    }
  });

  it("keeps tracked consumer copies byte-identical", async () => {
    const files = ["SKILL.md", "skill.yaml", "references/operations.md"];
    for (const target of [".claude", ".codex", ".gemini"]) {
      for (const file of files) {
        await expect(
          readFile(join(projectRoot, target, "skills", "skill-sync", file), "utf8"),
        ).resolves.toBe(await readFile(join(skillRoot, file), "utf8"));
      }
    }
  });
});
