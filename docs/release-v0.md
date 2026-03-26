# skill-sync v0 Release Criteria

## Support Matrix

| Feature | Status | Notes |
|---------|--------|-------|
| Local source | Implemented | Filesystem path resolution |
| Git source | Implemented | Shallow clone, single branch |
| Registry source | Not implemented | Deferred to v0.2+; `type: registry` is parsed but cannot be resolved |
| Mirror install mode | Implemented | SHA256 integrity tracking |
| Copy install mode | Implemented | No lock tracking |
| Symlink install mode | Implemented | Local dev only, not portable |
| CLI commands | Implemented | sync, status, validate, diff, doctor, pin, unpin, prune, promote |
| MCP server | Implemented | Read-only: resources, tools, prompts |
| Claude target | Implemented | .claude/skills |
| Codex target | Implemented | .codex/skills |
| Generic MCP target | Implemented | .agent/skills |
| Config injection | Implemented | skill-sync.config.yaml generation |
| Portability validation | Implemented | Non-portable path detection |
| Compatibility checking | Implemented | Agent feature support matrix |
| Trust policy | Implemented | Allowlist, blocklist, provenance |
| Script safety | Implemented | Warn/error on executable scripts |
| Bidirectional promotion | Manual only | Automated `promote` in v0.2 |

## Test Gates

All of the following must pass before release:

```bash
# Type checking
npx tsc --noEmit

# Full test suite
npx vitest run

# Expected: 271+ pass, 0 fail
```

Coverage gate (vitest --coverage):

```bash
# Statements ≥ 90%, Branches ≥ 86%, Functions ≥ 98%
npx vitest run --coverage
```

### Test Coverage Areas

| Area | Tests | Status |
|------|-------|--------|
| Core types & parsing | Parser, manifest, lock | Pass |
| Sync engine | Plan, drift, materializer, symlink mode | Pass |
| Resolver | Multi-source, transitive deps | Pass |
| Compatibility | Agent targets, feature matrix | Pass |
| Config generator | Layered merge, validation | Pass |
| Portability | Non-portable path detection | Pass |
| Validator | Skill packages, manifests, error paths | Pass |
| Trust | Allowlist, blocklist, provenance | Pass |
| Security | Script safety, unsafe patterns | Pass |
| CLI | All commands, help, JSON output, text output | Pass |
| MCP | Server creation, all tool handlers, prompts | Pass |
| Sources | Local and git source adapters, factory | Pass |
| Contract tests | CLI, MCP, syncer, validator | Pass |
| Instruction audit | Gemini, Claude, Codex file detection | Pass |

## Known Limitations

1. **Registry sources not implemented** — `type: registry` is parsed but cannot be resolved
2. **Promotion is manual** — No `skill-sync promote --auto` in v0
3. **Trust enforced at validation only** — `sync` does not block untrusted sources
4. **No content signatures** — Skills are integrity-checked (SHA256) but not cryptographically signed
5. **No plugin system** — Source types are hardcoded (local, git)
6. **No watch mode** — `sync` is a one-shot operation

## Distribution

```bash
# npm package
npm install -g skill-sync

# Binary entrypoint
skill-sync --help

# MCP server (stdio)
node dist/mcp/index.js [project-root]

# Programmatic API
import { parseManifest, planSync, createLockFile } from "skill-sync/core"
```

## Release Checklist

- [ ] All tests pass (`npx vitest run`)
- [ ] TypeScript compiles cleanly (`npx tsc --noEmit`)
- [ ] `package.json` version set to `0.1.0`
- [ ] README.md with quick-start guide
- [ ] `skill-sync --help` covers all commands
- [ ] Build output (`dist/`) is correct
- [ ] npm publish dry-run succeeds
