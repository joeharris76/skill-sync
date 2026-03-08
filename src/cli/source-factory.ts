// Re-export from the canonical shared location so both CLI and MCP can use it.
export {
  isImplementedSourceType,
  createSourcesFromConfig,
  createSourcesFromConfigForSkill,
} from "../sources/factory.js";
