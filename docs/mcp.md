# MCP Server

## Role of the MCP Server

The MCP server should expose the local `skillsync` store to agent clients that
need to discover, inspect, and consume synced skills without custom
filesystem-specific code.

The key design constraint is consistency: the MCP server should reflect the same
installed state and validation story as the CLI.

## Release-State Positioning

The recommended initial stance is read-first.

That means the MCP server should reliably support:
- listing installed skills
- searching installed skills
- fetching skill metadata
- fetching materialized skill content
- exposing validation or sync-status summaries where safe

Mutation through MCP should be added only after the trust and conflict model is
already well-defined in the core system.

## Planned MCP Concepts

### Resources

Likely resource categories:
- skill catalog
- individual skill metadata
- individual materialized skill content
- compatibility or source metadata views

### Prompts

Potential prompt surfaces:
- skill inspection guidance
- compatibility summaries
- sync health summaries

Prompt exposure is useful, but less important than getting resource semantics
right.

### Tools

Potential tool surfaces after the core model is stable:
- search installed skills
- validate installed skills
- inspect sync status

Mutating tools such as install/update should be gated carefully and may be
deferred.

## MCP Design Principles

- Read-only operations should always be safer and more mature than mutating ones.
- MCP clients should not need to understand internal store details.
- The server must not invent business rules that differ from CLI behavior.
- Responses should be precise enough for agents to reason about compatibility
  and installed state.

## Example Read-First Capabilities

- list installed skills with tags and compatibility targets
- search by name, trigger phrase, or tag
- fetch the current materialized form for a requested consumer target
- inspect whether a skill is drifted, invalid, or blocked by trust policy

## Relationship To CLI

The CLI is the operator surface.
The MCP server is the consumer surface.

That distinction helps keep remote mutation risk low while still making the
local store broadly usable.
