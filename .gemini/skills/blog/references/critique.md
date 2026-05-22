# Blog Critique Reference

Use for adversarial draft review. Default is read-only unless `--chain`/`--fix` is explicitly requested.

## Rubric

| Area | Questions |
|---|---|
| Thesis | Is the claim specific, defensible, and worth reading? |
| Audience | Is the reader clear, and are prerequisites handled? |
| Evidence | Are technical claims sourced, measured, or reproducible? |
| Structure | Does each section advance the argument without boilerplate? |
| Voice | Does it match the voice guide and avoid banned patterns? |
| Utility | Does the reader leave with a usable insight, command, or decision? |
| Risk | What could be misleading, stale, partisan, overclaimed, or underqualified? |
| Shelf-life | Date the outline against the source publication; flag if the response window has expired (typical: 1-2 weeks). Vendor-response posts only. |

## Vendor-Response Checks

Apply when the post responds to a vendor or source-author publication; skip on evergreen content.

- **Currency** (Risk lane): if the outline cites blocked TODOs, honest deferrals, or "not yet shipped" caveats, verify against `git log` and the current state of `_project/TODO/` and `_project/DONE/`. Flag any item shipped since the outline was written.
- **Partisan-Reader** (Voice lane): identify framings that contrast the source against BenchBox's coverage (boring/novel, surface/hidden, obvious/clever). For each, ask "would a reader from the source's team find this dismissive?" Substitute technical specificity for editorial contrast where the answer is yes: name the exact API, benchmark coverage, or operational limitation instead of ranking the source's work.

## Scoring

9-10 publish-ready, 7-8 targeted edits, 5-6 significant revision, <5 structural rethink.

## Output

Lead with blocking issues, then targeted improvements, suggested rewrites when useful, and publish readiness. Separate factual corrections from taste/preferences.

## Chain Mode

Only apply non-structural fixes: broken links, formatting, obvious factual corrections, localized rewrites. Leave thesis, framing, and controversial judgment calls for the user.
