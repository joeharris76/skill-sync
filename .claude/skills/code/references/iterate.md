# Iterate Reference

`/code iterate <command>` — run a command, debug each distinct failure, fix, re-run, loop until all pass, all remaining failures are hard-blocked, or the iteration cap is reached.

## When to Use

Use when your command runs a batch check (tests, benchmarks, migrations, linters), emits a structured pass/fail summary, and is failing on a subset you want driven to green through sequential root-cause fixes.

Examples: `"./scripts/local_stress_test.sh --scale 1 --platform doris"`, `"uv run -- python -m pytest tests/integration/"`, `"make test-all"`, `"npm run e2e"`

Do NOT use for: one-off commands, no structured output, interactive commands, commands that already pass.

## Loop Shape

```
Run command
    |
Parse failures
    |
Any failures? ---- no ----> exit 0 (green)
    |
   yes
    |
Cluster by signature
    |
For each distinct failure cluster:
  1. /code debug   (triage, measure, root cause)
  2. Apply fix     (narrow, follow fix hierarchy)
  3. Narrow re-verify
  4. /code review  (diff only)
  5. /code commit  (one logical fix)
    |
All remaining clusters hard-blocked?
    | yes
    +---------------------> exit 1 (blocked)
    |
   no
    |
Iteration cap reached?
    | yes
    +---------------------> exit 2 (capped)
    |
   no
    |
Re-run full command
    |
    +---------------------> Parse failures
```

## Step Details

### 1. Baseline Run

Execute the command. Capture stdout+stderr to `_project/iterate/<slug>/run<N>.log`. Slug = kebab-case of the command's first 2-3 significant tokens (e.g. `local-stress-test-doris`, `pytest-integration`).

Write / overwrite `_project/iterate/<slug>/status.md`:

```
# Iterate: <command>
Last run: <ISO timestamp> (run<N>)
Result: <pass|fail|blocked|capped>
Passing: X / Total
Failing: Y (clustered to Z distinct)
Hard-blocked: W
Commits this iteration: <hashes>
```

### 2. Parse Failures

Detect failure format. Common patterns:
- pytest: `FAILED tests/...::test_name - ErrorClass: message`
- Script: `PASSED:` / `FAILED:` blocks, non-zero exit
- Make: target name + error log
- Custom: user-supplied regex via `--parser "<regex>"`

If format is unrecognized, stop and ask the user for a parser hint — do not guess.

### 3. Cluster by Signature

Same (error class + failing-unit class) = one cluster. Failing-unit class = the kind of rerunnable unit emitted by the command: test case/module, benchmark query/table, linter file/rule, migration step, or make target.

Examples:
- 8 tables all failing with `DATA_QUALITY_ERROR` on stream load = one cluster, not eight
- 20 pytest cases all failing during module import with `ModuleNotFoundError` = one cluster

### 4. Per Cluster: Debug + Fix

Invoke `/code debug` with the error message, log path, and cluster members. It enforces the full triage, fix hierarchy, and blocker rules from `SHARED/debug-framework.md` — do not short-circuit.

### 5. Narrow Re-verify

Verify the fix against the minimal failing case (single test, single benchmark, smaller scale factor) before re-running the full command. Use `--narrow <cmd>` if supplied, otherwise derive from the failing unit (e.g. `pytest -k <test_name>`). Only proceed when it passes.

### 6. Review + Commit

- `/code review <diff>` — address Critical + Required findings, skip Nits.
- `/code commit` — one logical fix per commit. Message: `fix(<scope>): <what>` + one-line root cause in body.
- Never `git add -A`.

### 7. Loop

Re-run the full command. Diff the failure set vs the previous run:
- Resolved → update status.md
- Still present → re-enter debug (fix didn't apply or diagnosis wrong)
- New failures → regression; consider revert

Terminate when: full command exits 0 (green), all remaining meet hard-blocker criteria (record in `blockers.md`), or `--max-iterations` is reached (`status.md` result = `capped`).

## Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `--max-iterations N` | 20 | Safety cap; prevents runaway loops |
| `--narrow "<cmd>"` | derived | Explicit minimal-repro command for step 5 |
| `--parser "<regex>"` | auto | Override failure-parsing regex if format is unusual |
| `--resume` | off | Pick up from existing `status.md` instead of starting fresh |
| `--dry-run` | off | Parse failures only; do not invoke debug/fix/commit |
| `--skip-review` | off | Use with caution; skips `/code review` between fix and commit |

## Artifact Layout

```
_project/iterate/<slug>/
├── status.md            # overwritten each iteration
├── blockers.md          # append-only; add new entries, never overwrite old ones
├── run1.log             # full command output
├── run2.log
├── ...
└── commits.md           # hash + one-line per commit landed
```

## Blocker Record Format

`blockers.md` entries (one per blocker). Append a new entry each time a cluster is declared blocked; do not rewrite an older entry in place.

```markdown
## <cluster signature>
- **Recorded at**: <ISO timestamp>
- **Run**: <N>
- **Error**: <first line of error>
- **Root cause**: <diagnosis from /code debug>
- **Attempted**:
  - operation/session: <tried | ruled out> — <reason>
  - engine/config: <tried | ruled out> — <reason>
  - preprocessing: <tried | ruled out> — <reason>
  - code: <tried | ruled out> — <reason>
- **Why blocked**: <requires <upstream change | credentials | hardware | user decision>>
- **Unblock by**: <what the user/someone else needs to do>
```

## Anti-Patterns — Reject

- Increasing timeouts / memory / retries as a first move (see `SHARED/debug-framework.md`, Fix Hierarchy)
- Silencing a class of errors (`except Exception`, `strict_mode=false`, `--validation=disabled`) to pass a test
- Multiple unrelated fixes in one commit
- Skipping narrow re-verify "because the fix is obviously right"
- Declaring a blocker without documenting the attempted fix hierarchy
- Recalling numbers instead of measuring them

## Integration Notes

- **With `/loop`**: prefer `/code iterate` for iterate-to-green (has termination); use `/loop` for wall-clock polling (no termination).
- **With `/code review --chain`**: `--chain` is for review-then-fix on a single target; `/code iterate` is for driving a whole command to green.
- **With `SHARED/debug-framework.md`**: iterate inherits measurement-over-recall, fix hierarchy, narrow-over-broad, and hard-blocker rules via `/code debug`.
- **With MCP tools**: if the command is a shell wrapper for an MCP-driven operation, the user can pass the MCP call directly as `--narrow` for faster per-failure re-verify.
