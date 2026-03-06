import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

/**
 * Start the skillsync MCP server on stdio transport.
 * Reads project root from argv or defaults to cwd.
 */
export async function startMcpServer(projectRoot?: string): Promise<void> {
  const root = projectRoot ?? process.cwd();
  const server = createServer(root);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Auto-run when executed directly
const isDirectExecution =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("/mcp/index.js") || process.argv[1].endsWith("/mcp/index.ts"));

if (isDirectExecution) {
  const projectRoot = process.argv[2] ?? process.cwd();
  startMcpServer(projectRoot).catch((err) => {
    process.stderr.write(`MCP server error: ${err}\n`);
    process.exit(1);
  });
}

export { createServer } from "./server.js";
