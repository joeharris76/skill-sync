# Security Checklist Reference

For CLI tools, MCP servers, and Python applications.

## Three-Tier Boundaries

### Always Do
- Validate all external input at system boundaries (CLI args, MCP params, API inputs)
- Parameterize all SQL -- never concatenate user input into queries
- Never commit secrets (API keys, passwords, tokens, connection strings) to VCS
- Never log sensitive data (credentials, tokens, PII)
- Use `subprocess` with list args, never `shell=True` with user input
- Set restrictive file permissions (0o600 credentials, 0o755 directories)
- Pin dependency versions; audit before releases (`pip-audit`)

### Requires Human Approval
- New auth flows or credential handling
- New external service integrations
- File upload or arbitrary file path handlers
- Changes to permission models or access control
- New subprocess execution patterns

### Never Do
- `eval()`, `exec()`, or `pickle.loads()` with untrusted data
- Trust user-provided file paths without sanitization (path traversal)
- Expose stack traces or internal error details to users
- Embed credentials in source code or checked-in config

## OWASP Top 10 -- CLI/MCP Adaptation

| # | Vulnerability | Prevention |
|---|---|---|
| 1 | Injection | Parameterized queries, subprocess with list args |
| 2 | Broken Auth | Credential files with restricted perms, token rotation |
| 3 | Data Exposure | Encrypt at rest, mask in logs, redact in errors |
| 4 | Access Control | Validate ownership, least privilege |
| 5 | Misconfiguration | Pin versions, audit deps, no default creds |
| 6 | Vulnerable Components | `pip-audit`, monitor advisories |
| 7 | Path Traversal | `pathlib.resolve()`, reject `..`, validate paths |
| 8 | Command Injection | Never `shell=True` with user input, `shlex.quote()` |
| 9 | Insufficient Logging | Log auth failures + access denials |
| 10 | SSRF | Allowlist URLs, don't follow redirects to internal addrs |

## Input Validation Model

```
External input (CLI, MCP, API) -> VALIDATE HERE -> Internal (trust types) -> Output (sanitize sensitive data)
```

- Fail fast on invalid input (clear error, not silent corruption)
- Use schema validation (pydantic, typed dataclasses) at boundaries
- Don't re-validate inside internal functions
