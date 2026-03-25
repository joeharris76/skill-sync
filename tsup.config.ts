import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "cli/index": "src/cli/index.ts",
    "index": "src/index.ts",
    "core/index": "src/core/index.ts",
    "mcp/index": "src/mcp/index.ts",
  },
  format: "esm",
  target: "node20",
  splitting: true,
  clean: true,
  dts: true,
  outDir: "dist",
  sourcemap: true,
});
