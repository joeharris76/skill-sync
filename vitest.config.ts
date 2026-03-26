import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
