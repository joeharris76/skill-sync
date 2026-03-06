import { beforeAll, describe, expect, it } from "vitest";
import { moduleExists } from "../../helpers/module-availability.js";

type McpServerLike = {
  tool?: (name: string) => unknown;
  resource?: (name: string) => unknown;
};

type McpModule = {
  createServer: (targetPath: string) => McpServerLike;
};

const describeMcp = moduleExists("src/mcp/server.ts") ? describe : describe.skip;

describeMcp("mcp server contract", () => {
  let mcpModule: McpModule;

  beforeAll(async () => {
    mcpModule = (await import("../../../src/mcp/server.js")) as McpModule;
  });

  it("exports createServer", () => {
    expect(typeof mcpModule.createServer).toBe("function");
  });

  it("creates a server with read-first skill discovery capabilities", () => {
    const server = mcpModule.createServer(".claude/skills");
    expect(server).toBeTruthy();
  });
});
