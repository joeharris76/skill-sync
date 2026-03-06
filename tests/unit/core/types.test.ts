import { describe, expect, it, expectTypeOf } from "vitest";
import type {
  ConfigInput,
  DriftEntry,
  DriftReport,
  FetchedSkill,
  FileChange,
  InstallMode,
  LockedSkill,
  LockFile,
  Manifest,
  ResolvedSkill,
  SkillFile,
  SkillMdMetadata,
  SkillOverride,
  SkillPackage,
  SkillSource,
  SkillSyncMeta,
  SourceConfig,
  SourceProvenance,
  SourceType,
  SyncPlan,
  ValidationDiagnostic,
  ValidationResult,
} from "../../../src/index.js";

describe("core type surface", () => {
  it("supports canonical skill package objects", () => {
    const skillMd: SkillMdMetadata = {
      name: "code",
      description: "Investigate and edit code",
      license: "MIT",
      allowedTools: ["Bash", "Read", "Edit"],
      metadata: { domain: "engineering" },
      compatibility: { claude: true, codex: true },
    };

    const meta: SkillSyncMeta = {
      tags: ["code", "review"],
      category: "development",
      depends: ["SHARED/commit-framework"],
      configInputs: [
        {
          key: "code.verify",
          type: "string",
          description: "Verification command",
          default: "npm run test:run",
        },
      ],
      targets: {
        claude: true,
        codex: true,
        "generic-mcp": true,
      },
      source: {
        type: "local",
        name: "personal",
        path: "/tmp/skills/code",
        fetchedAt: "2026-03-06T10:00:00Z",
      },
    };

    const files: SkillFile[] = [
      {
        relativePath: "SKILL.md",
        size: 128,
        sha256:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      },
    ];

    const pkg: SkillPackage = {
      name: "code",
      description: "Investigate and edit code",
      path: "/tmp/skills/code",
      skillMd,
      meta,
      files,
    };

    expect(pkg.name).toBe("code");
    expect(pkg.meta?.targets.codex).toBe(true);
    expect(pkg.files[0]?.relativePath).toBe("SKILL.md");
  });

  it("supports manifest, lock, and sync plan shapes", () => {
    const source: SourceConfig = {
      name: "team",
      type: "git",
      url: "git@github.com:myorg/team-skills.git",
      ref: "main",
    };

    const override: SkillOverride = {
      installMode: "copy",
    };

    const manifest: Manifest = {
      version: 1,
      sources: [source],
      skills: ["code", "test"],
      profile: "python-backend",
      targets: {
        claude: ".claude/skills",
        codex: ".codex/skills",
      },
      installMode: "mirror",
      config: {
        code: { verify: "npm run test:run" },
      },
      overrides: {
        test: override,
      },
    };

    const lock: LockFile = {
      version: 1,
      lockedAt: "2026-03-06T10:30:00Z",
      skills: {
        code: {
          source: {
            type: "git",
            name: "team",
            url: "git@github.com:myorg/team-skills.git",
            ref: "main",
            revision: "abcdef123456",
            fetchedAt: "2026-03-06T10:00:00Z",
          },
          installMode: "mirror",
          files: {
            "SKILL.md": {
              sha256:
                "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
              size: 512,
            },
          },
        },
      },
    };

    const plan: SyncPlan = {
      install: [],
      update: [
        {
          name: "code",
          source: lock.skills.code!.source,
          installMode: "mirror",
          changedFiles: [
            {
              path: "SKILL.md",
              oldSha256:
                "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
              newSha256:
                "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
            },
          ],
        },
      ],
      remove: [],
      conflicts: [],
      unchanged: ["test"],
      warnings: [],
    };

    expect(manifest.overrides.test?.installMode).toBe("copy");
    expect(lock.skills.code?.installMode).toBe("mirror");
    expect(plan.update[0]?.changedFiles[0]?.path).toBe("SKILL.md");
  });

  it("supports validation and drift report contracts", () => {
    const modified: DriftEntry = {
      skill: "code",
      file: "SKILL.md",
      expected: "expected-sha",
      actual: "actual-sha",
    };

    const drift: DriftReport = {
      clean: ["test"],
      modified: [modified],
      missing: ["todo"],
      extra: ["local-only"],
    };

    const validation: ValidationResult = {
      valid: false,
      diagnostics: [
        {
          rule: "portable-relative-paths",
          severity: "error",
          message: "Absolute paths are not allowed",
          skill: "invalid-absolute-path",
          file: "SKILL.md",
          line: 8,
        },
      ],
    };

    expect(drift.modified[0]?.skill).toBe("code");
    expect(validation.valid).toBe(false);
    expect(validation.diagnostics[0]?.severity).toBe("error");
  });

  it("enforces expected literal unions at the type level", () => {
    expectTypeOf<InstallMode>().toEqualTypeOf<"copy" | "symlink" | "mirror">();
    expectTypeOf<SourceType>().toEqualTypeOf<"local" | "git" | "registry">();
    expectTypeOf<ConfigInput["type"]>().toEqualTypeOf<
      "string" | "number" | "boolean"
    >();
    expectTypeOf<ValidationDiagnostic["severity"]>().toEqualTypeOf<
      "error" | "warning"
    >();
  });

  it("describes the source adapter interface", () => {
    expectTypeOf<SkillSource["name"]>().toEqualTypeOf<string>();
    expectTypeOf<SkillSource["type"]>().toEqualTypeOf<SourceType>();
    expectTypeOf<SkillSource["resolve"]>().returns.toEqualTypeOf<
      Promise<ResolvedSkill | null>
    >();
    expectTypeOf<SkillSource["fetch"]>().returns.toEqualTypeOf<
      Promise<FetchedSkill>
    >();
    expectTypeOf<SkillSource["provenance"]>().returns.toEqualTypeOf<SourceProvenance>();
  });
});

