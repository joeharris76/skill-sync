# MCP Server

## Role of the MCP Server

The MCP server exposes the local `skillsync` store to agent clients that need
to discover, inspect, and consume synced skills without custom
filesystem-specific code.

The key design constraint is consistency: the MCP server reflects the same
installed state and validation story as the CLI.

## v0 Surface (Read-Only)

The v0 MCP server is read-only. It supports skill discovery, content retrieval,
status inspection, and validation. Mutation tools are deferred to v0.2+ after
the trust and conflict model is stable.

### Resources

| Name | URI | Description |
|------|-----|-------------|
| `skills-list` | `skill://list` | JSON listing of all installed skills with name, description, and file count |
| `skill` | `skill://{name}` | Read a skill's SKILL.md content (text/markdown) |
| `skill-file` | `skill://{name}/{+path}` | Read a specific file within a skill package (path traversal protected) |

The `skill://{name}` resource template supports dynamic listing — clients can
enumerate all installed skills by querying the template's list callback.

### Tools

| Tool | Input | Description |
|------|-------|-------------|
| `search-skills` | `query: string` | Search installed skills by name, description, or tag. Returns matching skills with names, descriptions, tags, and file lists. |
| `skill-status` | — | Show installation status and drift for all skills across all configured targets. Returns clean, modified, missing, and extra skill lists per target. |
| `validate-skills` | — | Run portability and compatibility validation on all installed skills. Returns `valid` boolean and diagnostic list with severity, rule, message, skill name, and optional `file` and `line` fields. |

### Prompts

| Prompt | Input | Description |
|--------|-------|-------------|
| `use-skill` | `name: string` | Generate a prompt incorporating a skill's SKILL.md instructions. Strips YAML frontmatter and wraps the body as user-facing instructions. |

## Implementation

The MCP server is implemented in `src/mcp/server.ts` with a stdio transport
entry point at `src/mcp/index.ts`.

It imports directly from `core/` modules:
- `manifest.ts` — read project manifest for target configuration
- `lock.ts` — read lock file for drift detection
- `drift.ts` — detect drift between installed files and lock state
- `parser.ts` — load skill packages from disk
- `portability.ts` — validate portable path usage
- `compatibility.ts` — check agent target compatibility
- `config-generator.ts` — validate config overrides

The server discovers installed skills by recursively scanning target directories
for `SKILL.md` files. It supports nested skill names (e.g., `SHARED/commit-framework`).

## MCP Design Principles

- Read-only operations are safer and more mature than mutating ones.
- MCP clients do not need to understand internal store details.
- The server does not invent business rules that differ from CLI behavior.
- Responses are precise enough for agents to reason about compatibility
  and installed state.

## Running the Server

```bash
# Direct execution
node dist/mcp/index.js /path/to/project

# Claude Code configuration
{
  "mcpServers": {
    "skillsync": {
      "command": "node",
      "args": ["dist/mcp/index.js", "/path/to/project"]
    }
  }
}
```

## Relationship To CLI

The CLI is the operator surface.
The MCP server is the consumer surface.

That distinction keeps remote mutation risk low while making the local store
broadly usable by agent clients.
