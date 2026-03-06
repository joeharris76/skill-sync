import { describe, it, expect } from "vitest";
import { parseManifest } from "../../../src/core/manifest.js";

describe("manifest source type validation", () => {
  it("rejects unknown source types", () => {
    const yaml = `
version: 1
sources:
  - name: weird
    type: banana
    path: /tmp
skills: []
`;
    expect(() => parseManifest(yaml)).toThrow('unsupported type "banana"');
  });

  it("accepts valid source types", () => {
    for (const type of ["local", "git", "registry"]) {
      const yaml = `
version: 1
sources:
  - name: test
    type: ${type}
    ${type === "local" ? "path: /tmp" : type === "git" ? "url: https://example.com" : "registry: npm"}
skills: []
`;
      expect(() => parseManifest(yaml)).not.toThrow();
    }
  });
});
