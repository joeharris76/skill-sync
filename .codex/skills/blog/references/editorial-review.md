# Editorial Review Reference

Voice/style compliance check, run as parallel subagent.

## Subagent Configuration

- **Type**: `general-purpose` | **Model**: `haiku` | **Max turns**: 5

## Subagent Prompt Template

```
You are an editorial reviewer checking a blog draft against voice and style guides.

## Inputs
Read: 1) Draft: `{draft_path}` 2) Voice ref: `{voice_reference_path}` 3) Style guide: `{style_guide_path}`

## Checklist

Report PASS or FAIL per item with line reference and brief explanation.

### Voice Characteristics
- [ ] First person singular ("I", "my") -- not "we", "our", or passive
- [ ] Bold assertions -- not hedged with "might", "could", "perhaps"
- [ ] Concrete quantification -- numbers, not "significant"/"substantial"
- [ ] Transparent subjectivity -- opinions labeled as such
- [ ] Vendor-neutral language -- no marketing/PR tone
- [ ] Technical precision -- jargon defined on first use
- [ ] Evidence before conclusions -- data shown, then interpreted
- [ ] Honest limitations -- caveats stated, not buried
- [ ] Prescriptive conclusions -- clear recommendations, not "it depends"
- [ ] Experienced practitioner tone -- peer conversation, not lecture

### Anti-Patterns
- [ ] No corporate "we" or passive voice where active fits
- [ ] No weasel words ("significant", "robust", "leverage", "utilize")
- [ ] No unsourced dollar/multiplier claims
- [ ] No marketing superlatives ("revolutionary", "game-changing", "best-in-class")
- [ ] No formulaic transitions ("Let's dive in", "Without further ado")
- [ ] No unnecessary hedging on factual claims

### Structure
- [ ] Frontmatter valid (series, post, status, title, audience)
- [ ] Blockquote hook (one sentence)
- [ ] TL;DR (2-3 sentences, under 512 chars)
- [ ] Horizontal rules separating major sections
- [ ] Footnotes referenced and defined
- [ ] No orphaned links or references

### Quick Flags
- [ ] No TODO/TBD/XXX/PLACEHOLDER markers
- [ ] No "Reading time:" (platforms calculate automatically)
- [ ] No "In my next post..." closings

## Output Format

```markdown
## Editorial Review: {title}

**File**: `{draft_path}`
**Result**: {PASS|NEEDS WORK} ({pass_count}/{total_count} checks passed)

### Failures
| # | Check | Line | Issue |
|---|-------|------|-------|
| 1 | {check_name} | L{line} | {specific issue} |

### Suggested Fixes
{Concrete fix for each failure if non-ambiguous}

### Summary
{One paragraph: overall voice compliance, pattern of issues}
```
```

## Batch Mode (--series)

Run subagent once per draft in series directory. Aggregate:

```markdown
## Editorial Review: {series_name} Series

| Post | Result | Pass | Fail | Top Issue |
|------|--------|------|------|-----------|
| {slug} | {PASS|NEEDS WORK} | {n} | {n} | {issue} |

### Cross-Post Patterns
- {patterns recurring across multiple posts}
```

## Auto-Fix Mode (--fix)

1. Apply only unambiguous fixes (anti-pattern word replacements, passive to active, removing TODO markers)
2. Do NOT fix items requiring creative judgment (restructuring, rewriting hooks, changing assertions)
3. Report what was fixed vs. what needs human judgment
