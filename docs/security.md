# SkillSync Security & Trust Model

## Trust Policy

SkillSync uses a declarative trust policy to control which skill sources
are allowed in a project. In v0, all sources declared in `skillsync.yaml`
are trusted by default.

### Source Allowlists

Projects can restrict sources to an explicit allowlist:

```yaml
# skillsync.yaml
trust:
  allowed_sources:
    - type: local                           # Allow all local sources
    - url_prefix: https://github.com/myorg/ # Allow specific GitHub org
  blocked_sources:
    - name: untrusted-community             # Block specific source
```

### Provenance Tracking

Every installed skill records its source provenance in `skillsync.lock`:
- Source type and name
- Path or URL
- Git ref and resolved commit SHA (for git sources)
- Fetch timestamp

Run `skillsync status --json` to inspect provenance for all installed skills.

### Trust Policy Enforcement

| Check | Default | Configurable |
|-------|---------|--------------|
| Source allowlist | All manifest sources trusted | Yes |
| Source blocklist | None blocked | Yes |
| Provenance required | No | Yes |
| Executable scripts | Warn | Yes (`allowScripts: false` to error) |

## Executable Scripts

Skills may contain `scripts/` directories with executable files. SkillSync:

1. **Warns** about executable scripts during `skillsync validate`
2. **Never executes** scripts — it only copies/materializes them
3. Can be configured to **error** on scripts via trust policy

Supported agent targets handle scripts differently:

| Target | Script Handling |
|--------|----------------|
| Claude Code | May execute via Bash tool |
| Codex | May execute |
| Generic MCP | Resources only (no execution) |

## Validation Diagnostics

`skillsync validate` checks:

- **Manifest validity**: version, sources, skills, targets
- **Source type support**: warns on unimplemented source types (e.g., registry)
- **Portability**: non-portable paths in skill content
- **Compatibility**: agent-specific feature support
- **Config coherence**: config keys match declared inputs
- **Lock file presence**: warns if no lock file exists
- **Script presence**: warns about executable scripts

All diagnostics include:
- Rule identifier (machine-readable)
- Severity (error or warning)
- Actionable message
- Skill name and file location (when applicable)

## Known Limitations (v0)

- Trust policy is evaluated at validation time, not enforced at sync time
- No signature verification for skill content
- No sandboxing of skill scripts
- Registry sources are not yet implemented
