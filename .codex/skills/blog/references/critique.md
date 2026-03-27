# Blog Critique Reference

Adversarial blog post review rubric.

## Review Areas

### Style Compliance

| Check | What to Look For |
|-------|------------------|
| Voice | Matches project voice reference guide |
| Jargon | Technical terms explained on first use |
| Data-first | Claims backed by specific numbers |
| Format | Title with specifics, hook, TL;DR, clear sections, code blocks |

### Technical Accuracy

| Check | Verification |
|-------|--------------|
| Benchmarks | Data correct, reproducible |
| Citations | Sources valid, recent |
| Claims | Supported by evidence |
| Methodology | Documented, limitations noted |
| Environment | Hardware/software documented |

### Engagement

| Element | Target |
|---------|--------|
| Hook | Compelling, draws reader in |
| Flow | Logical progression |
| Transitions | Smooth between sections |
| Paragraphs | Short (3-4 sentences) |
| Skimmability | Headers, bullets, visual breaks |

### Editorial

| Check | Standard |
|-------|----------|
| Title | Specific, under 70 chars |
| Evidence | Present for all claims |
| Code | Valid, tested |
| Links | Working |
| Length | Appropriate for type |

## Scoring

| Score | Meaning |
|-------|---------|
| 9-10 | Publish-ready with minor polish |
| 7-8 | Solid, needs targeted improvements |
| 5-6 | Significant revision required |
| <5 | Structural/fundamental issues |

## Common Issues

- **Structure**: Burying the lede, missing thesis, repetitive conclusion, poor section order
- **Style**: Passive voice overuse, unexplained jargon, too formal, missing "why care"
- **Technical**: Unsupported claims, missing methodology, outdated sources, no limitations
- **Engagement**: Weak hook, long paragraphs (>5 sentences), no visual breaks, abrupt ending

## Report Format

```markdown
## Blog Critique: {Title}

### Overview
- **File**: `{path}`
- **Word Count**: X,XXX
- **Quality**: [Excellent/Good/Needs Work/Major Revision]

### Style Compliance
| Category | Score | Notes |
|----------|-------|-------|
| Voice | X/10 | |
| Data-First | X/10 | |
| Formatting | X/10 | |

### Issues Found
| Severity | Location | Issue | Recommendation |
|----------|----------|-------|----------------|
| Critical | Para 3 | Unsupported claim | Add citation |

### Section Analysis

#### {Section Name}
- **Strength**: {what works}
- **Weakness**: {what doesn't}
- **Suggestion**: {improvement}

### Rewrites Suggested
**Original**: > {text}
**Suggested**: > {improved text}

### Action Items
- [ ] **CRITICAL**: {must fix before publish}
- [ ] **HIGH**: {strongly recommended}
- [ ] **MEDIUM**: {nice to have}

### Recommendation
**Publish Ready**: [Yes / After Edits / Needs Revision / Major Rewrite]
```
