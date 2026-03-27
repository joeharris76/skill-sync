# Content Audit Reference

Batch analysis across posts to find cross-post patterns and systemic issues.

## Scope Resolution

| Input | Scope |
|-------|-------|
| `--series={name}` | All drafts in `_blog/drafts/{name}/` and `_blog/substack-drafts/{name}/` |
| `--tier={2\|3\|4}` | Posts at that tier in `_blog/PUBLICATION_SCHEDULE.md` |
| `--all` | All files in `_blog/drafts/` and `_blog/substack-drafts/` |
| Specific file list | Only those files |

## Per-Post Checks

| Check | What | Severity |
|-------|------|----------|
| Frontmatter | Required: `series`, `post`, `status`, `title`, `audience` | Error |
| Status | Must be: `outline`, `draft`, `draft-complete`, `review`, `published` | Error |
| Placeholders | `TODO`, `TBD`, `XXX`, `PLACEHOLDER`, `[INSERT`, `{REPLACE` | Error |
| Orphaned footnotes | `[^n]` without matching definitions (or vice versa) | Warning |
| Orphaned links | Empty url, `#`, or `example.com` links | Warning |
| Empty sections | Headers with no content before next header | Warning |
| Word count | Under 800 or over 4,000 words | Info |

## Cross-Post Checks (series/batch scope)

| Check | What | Severity |
|-------|------|----------|
| Duplicate titles | Same/near-identical titles | Error |
| Post numbering | Gaps/duplicates in `post` field within series | Error |
| Structural repetition | Identical H2 patterns across 3+ posts | Warning |
| Hook repetition | Similar opening hooks | Warning |
| TL;DR repetition | Similar TL;DR patterns | Warning |
| Closing repetition | Similar closing patterns | Warning |
| Voice drift | Mixing first-person-singular with "we"/"our" | Warning |
| Missing series plan | Series dir exists but no `series-plan.md` | Info |

## Report Format

```markdown
## Content Audit: {scope_description}

**Scope**: {n} posts across {m} series
**Run**: {date}

### Summary
| Severity | Count |
|----------|-------|
| Errors   | {n}   |
| Warnings | {n}   |
| Info     | {n}   |

### Errors
| Post | Check | Details |
|------|-------|---------|
| `{path}` | {check} | {details} |

### Warnings
| Post | Check | Details |
|------|-------|---------|
| `{path}` | {check} | {details} |

### Cross-Post Patterns
#### Structural Repetition
- Posts sharing identical H2 sequences: {list}
- Recommended variations: {suggestions}

#### Voice Consistency
- Posts using "we"/"our": {list}
- Posts with passive voice dominance: {list}

### Info
| Post | Check | Details |
|------|-------|---------|
| `{path}` | {check} | {details} |

### Recommendations
1. {Prioritized fixes, errors first}
```

## Implementation Notes

- Read `_blog/PUBLICATION_SCHEDULE.md` for `--tier` scope
- For `--series`, scan both `drafts/{series}/` and `substack-drafts/{series}/`
- Warn if scope exceeds 50 posts
- Word count: markdown body only (exclude frontmatter, code blocks, footnote definitions)
- Use Glob to discover files, Read to check content -- no edits in audit mode
