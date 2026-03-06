import { describe, it, expect } from "vitest";
import {
  checkSourceTrust,
  checkProvenanceRequired,
  formatProvenanceReport,
} from "../../../src/core/trust.js";
import type { TrustPolicy } from "../../../src/core/trust.js";

describe("checkSourceTrust", () => {
  it("allows all sources with default policy", () => {
    const diags = checkSourceTrust(
      { name: "test", type: "local", path: "/tmp" },
      {},
    );
    expect(diags).toEqual([]);
  });

  it("blocks sources on blocklist", () => {
    const policy: TrustPolicy = {
      blockedSources: [{ name: "untrusted" }],
    };
    const diags = checkSourceTrust(
      { name: "untrusted", type: "git", url: "https://evil.com" },
      policy,
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]!.rule).toBe("blocked-source");
    expect(diags[0]!.severity).toBe("error");
  });

  it("rejects sources not in allowlist", () => {
    const policy: TrustPolicy = {
      allowedSources: [{ type: "local" }],
    };
    const diags = checkSourceTrust(
      { name: "remote", type: "git", url: "https://example.com" },
      policy,
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]!.rule).toBe("untrusted-source");
  });

  it("allows sources matching allowlist", () => {
    const policy: TrustPolicy = {
      allowedSources: [{ type: "local" }, { urlPrefix: "https://github.com/myorg/" }],
    };
    const diags = checkSourceTrust(
      { name: "team", type: "git", url: "https://github.com/myorg/skills" },
      policy,
    );
    expect(diags).toEqual([]);
  });

  it("blocklist takes precedence over allowlist", () => {
    const policy: TrustPolicy = {
      allowedSources: [{ type: "git" }],
      blockedSources: [{ name: "banned" }],
    };
    const diags = checkSourceTrust(
      { name: "banned", type: "git", url: "https://example.com" },
      policy,
    );
    expect(diags[0]!.rule).toBe("blocked-source");
  });
});

describe("checkProvenanceRequired", () => {
  it("passes when provenance not required", () => {
    const diags = checkProvenanceRequired("test", undefined, { requireProvenance: false });
    expect(diags).toEqual([]);
  });

  it("fails when provenance required but missing", () => {
    const diags = checkProvenanceRequired("test", undefined, { requireProvenance: true });
    expect(diags).toHaveLength(1);
    expect(diags[0]!.rule).toBe("missing-provenance");
  });

  it("passes when provenance required and present", () => {
    const diags = checkProvenanceRequired("test", {
      type: "local",
      name: "personal",
      fetchedAt: "2026-03-06T10:00:00Z",
    }, { requireProvenance: true });
    expect(diags).toEqual([]);
  });
});

describe("formatProvenanceReport", () => {
  it("formats provenance for display", () => {
    const report = formatProvenanceReport([
      {
        name: "code",
        provenance: {
          type: "local",
          name: "personal",
          path: "/home/user/skills/code",
          fetchedAt: "2026-03-06T10:00:00Z",
        },
      },
      { name: "orphan" },
    ]);
    expect(report).toHaveLength(2);
    expect(report[0]!.skill).toBe("code");
    expect(report[0]!.sourceType).toBe("local");
    expect(report[1]!.sourceType).toBe("unknown");
  });
});
