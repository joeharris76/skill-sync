// Re-export from the canonical shared location so both CLI and MCP can use it.
export {
  createSourcesFromConfig,
  createSourcesFromConfigForSkill,
  isImplementedSourceType,
} from "../sources/factory.js";
