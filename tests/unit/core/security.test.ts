import { describe, it, expect } from "vitest";
import { checkScriptSafety, checkUnsafePatterns } from "../../../src/core/security.js";
import type { SkillPackage } from "../../../src/core/types.js";

function makePackage(files: Array<{ relativePath: string }>): SkillPackage {
  return {
    name: "test-skill",
    description: "test",
    path: "/tmp/test-skill",
    skillMd: { name: "test-skill", description: "test" },
    meta: null,
    files: files.map((f) => ({ ...f, sha256: "x", size: 10 })),
  };
}

describe("checkScriptSafety", () => {
  it("warns about executable scripts in scripts/", () => {
    const pkg = makePackage([
      { relativePath: "SKILL.md" },
      { relativePath: "scripts/build.sh" },
    ]);
    const diags = checkScriptSafety(pkg);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.rule).toBe("executable-script");
    expect(diags[0]!.severity).toBe("warning");
  });

  it("errors on scripts when policy disallows them", () => {
    const pkg = makePackage([
      { relativePath: "SKILL.md" },
      { relativePath: "scripts/deploy.py" },
    ]);
    const diags = checkScriptSafety(pkg, { allowScripts: false });
    expect(diags).toHaveLength(1);
    expect(diags[0]!.severity).toBe("error");
  });

  it("no warnings for packages without scripts", () => {
    const pkg = makePackage([
      { relativePath: "SKILL.md" },
      { relativePath: "references/api.md" },
    ]);
    const diags = checkScriptSafety(pkg);
    expect(diags).toEqual([]);
  });
});

describe("checkUnsafePatterns", () => {
  it("warns about shebangs outside scripts/", () => {
    const pkg = makePackage([{ relativePath: "helper.sh" }]);
    const content = new Map([["helper.sh", "#!/bin/bash\necho hi"]]);
    const diags = checkUnsafePatterns(pkg, content);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.rule).toBe("unexpected-shebang");
  });

  it("does not warn about shebangs in scripts/", () => {
    const pkg = makePackage([{ relativePath: "scripts/run.sh" }]);
    const content = new Map([["scripts/run.sh", "#!/bin/bash\necho hi"]]);
    const diags = checkUnsafePatterns(pkg, content);
    expect(diags).toEqual([]);
  });
});
