import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only the checkout's canonical test tree is part of the default suite.
    // Linked review worktrees under hidden agent directories are separate
    // checkouts and may intentionally contain stale expectations.
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        // Barrel re-export files — no logic, just re-exports
        "src/index.ts",
        "src/sources/index.ts",
        // stdio entrypoint — not unit-testable (process.argv, StdioServerTransport)
        "src/mcp/index.ts",
        // Pure TypeScript interface files — no executable statements
        "src/core/types.ts",
        "src/core/instruction-types.ts",
        "src/cli/types.ts",
      ],
    },
  },
});
