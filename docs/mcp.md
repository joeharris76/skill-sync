# MCP Server

## Role of the MCP Server

The MCP server exposes the full `skillsync` capability set to agent clients.
It has the same surface area as the CLI — discovery, inspection, validation,
sync, and lifecycle management — without requiring filesystem-specific glue
code from the consuming agent.

The key design constraint is consistency: the MCP server and CLI call the same
`core/` functions. Neither invents its own business logic over the same files.

## v0 Surface

### Resources

| Name | URI | Description |
|------|-----|-------------|
| `skills-list` | `skill://list` | JSON listing of all installed skills with name, description, and file count |
| `skill` | `skill://{name}` | Read a skill's SKILL.md content (text/markdown) |
| `skill-file` | `skill://{name}/{+path}` | Read a specific file within a skill package (path traversal protected) |

The `skill://{name}` resource template supports dynamic listing — clients can
enumerate all installed skills by querying the template's list callback.

### Tools

#### Discovery and Inspection

| Tool | Input | Description |
|------|-------|-------------|
| `search-skills` | `query: string` | Search installed skills by name, description, or tag. Returns matching skills with names, descriptions, tags, and file lists. |
| `skill-status` | — | Show installation status and drift for all skills across all configured targets. Returns clean, modified, missing, and extra skill lists per target. |
| `validate-skills` | — | Run portability and compatibility validation on all installed skills. Returns `valid` boolean and diagnostic list with severity, rule, message, skill name, and optional `file` and `line` fields. |

#### Sync and Lifecycle

| Tool | Input | Description |
|------|-------|-------------|
| `sync-skills` | `dry_run?: bool`, `force?: bool` | Resolve skills from configured sources and apply to all targets. `dry_run` previews the plan without applying. `force` overwrites local modifications. |
| `pin-skill` | `skill: string` | Lock a skill to its current git revision so future syncs use that exact version. Only works for git-sourced skills with a resolved revision. |
| `unpin-skill` | `skill: string` | Remove a revision pin, allowing the skill to float and receive updates on future syncs. |
| `prune-skills` | `dry_run?: bool` | Remove installed skills not declared in the project manifest. `dry_run` shows what would be removed. |
| `promote-skill` | `skill?: string` | Return guidance for promoting local skill modifications back to their canonical source. Automated promotion is planned for v0.2. |
| `doctor-skills` | — | Run comprehensive health diagnostics: manifest validity, lock file, source types, target directories, drift detection, and portability. Returns `healthy` boolean and per-check results. |

### Prompts

| Prompt | Input | Description |
|--------|-------|-------------|
| `use-skill` | `name: string` | Generate a prompt incorporating a skill's SKILL.md instructions. Strips YAML frontmatter and wraps the body as user-facing instructions. |

## Implementation

The MCP server is implemented in `src/mcp/server.ts` with a stdio transport
entry point at `src/mcp/index.ts`.

It imports directly from `core/` and `sources/` modules:
- `manifest.ts` — read and write project manifest
- `lock.ts` — read/write lock file, create lock entries
- `drift.ts` — detect drift between installed files and lock state
- `parser.ts` — load skill packages from disk
- `portability.ts` — validate portable path usage
- `compatibility.ts` — check agent target compatibility
- `config-generator.ts` — validate config overrides and generate project-config.yaml
- `resolver.ts` — resolve skill names against configured sources
- `syncer.ts` — plan sync operations
- `materializer.ts` — materialize and dematerialize skills on disk
- `sources/factory.ts` — instantiate source adapters from manifest config

The server discovers installed skills by recursively scanning target directories
for `SKILL.md` files. It supports nested skill names (e.g., `SHARED/commit-framework`).

## MCP Design Principles

- MCP and CLI have the same surface area and capabilities.
- Both call the same `core/` functions — neither invents separate business logic.
- MCP clients do not need to understand internal store details.
- Responses are precise enough for agents to reason about compatibility,
  installed state, and operation results.

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

The CLI and MCP server are two surfaces over one shared core. They are peers,
not a hierarchy. An agent using the MCP server has access to the same
operations a developer using the CLI has.
