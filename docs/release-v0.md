# SkillSync v0 Release Criteria

## Support Matrix

| Feature | Status | Notes |
|---------|--------|-------|
| Local source | Implemented | Filesystem path resolution |
| Git source | Implemented | Shallow clone, single branch |
| Registry source | Not implemented | Deferred to v0.2 |
| Mirror install mode | Implemented | SHA256 integrity tracking |
| Copy install mode | Implemented | No lock tracking |
| Symlink install mode | Implemented | Local dev only, not portable |
| CLI commands | Implemented | sync, status, validate, diff, doctor, pin, unpin, prune, promote |
| MCP server | Implemented | Read-only: resources, tools, prompts |
| Claude target | Implemented | .claude/skills |
| Codex target | Implemented | .codex/skills |
| Generic MCP target | Implemented | .agent/skills |
| Config injection | Implemented | project-config.yaml generation |
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

# Expected: 137+ pass, 0 fail
```

### Test Coverage Areas

| Area | Tests | Status |
|------|-------|--------|
| Core types & parsing | Parser, manifest, lock | Pass |
| Sync engine | Plan, drift, materializer | Pass |
| Resolver | Multi-source, transitive deps | Pass |
| Compatibility | Agent targets, feature matrix | Pass |
| Config generator | Layered merge, validation | Pass |
| Portability | Non-portable path detection | Pass |
| Validator | Skill packages, manifests | Pass |
| Trust | Allowlist, blocklist, provenance | Pass |
| Security | Script safety, unsafe patterns | Pass |
| CLI | All commands, help, JSON output | Pass |
| MCP | Server creation, skill discovery | Pass |
| Contract tests | CLI, MCP, syncer, validator | Pass |

## Known Limitations

1. **Registry sources not implemented** — `type: registry` is parsed but cannot be resolved
2. **Promotion is manual** — No `skillsync promote --auto` in v0
3. **Trust enforced at validation only** — `sync` does not block untrusted sources
4. **No content signatures** — Skills are integrity-checked (SHA256) but not cryptographically signed
5. **No plugin system** — Source types are hardcoded (local, git)
6. **No watch mode** — `sync` is a one-shot operation

## Distribution

```bash
# npm package
npm install -g skillsync

# Binary entrypoint
skillsync --help

# MCP server (stdio)
node dist/mcp/index.js [project-root]

# Programmatic API
import { parseManifest, planSync, createLockFile } from "skillsync/core"
```

## Release Checklist

- [ ] All tests pass (`npx vitest run`)
- [ ] TypeScript compiles cleanly (`npx tsc --noEmit`)
- [ ] `package.json` version set to `0.1.0`
- [ ] README.md with quick-start guide
- [ ] `skillsync --help` covers all commands
- [ ] Build output (`dist/`) is correct
- [ ] npm publish dry-run succeeds
