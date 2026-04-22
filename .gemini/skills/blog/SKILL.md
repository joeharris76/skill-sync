---
name: blog
description: This skill should be used when the user asks to "plan a blog post", "research for blog", "draft a blog post", "critique a draft", "deformulize a post", "commit blog changes", "editorial review", "voice check", "style check", "audit blog", "content audit", "audit series", or "audit drafts".
version: 0.4.0
tools: Bash, Read, Write, Edit, Agent, Glob, Grep
---

# Blog Workflow

## Guide Resolution

Fallback chain for style and voice guides:

1. **Project-level** (preferred): `_blog/STYLE_GUIDE.md` and `_blog/VOICE_REFERENCE.md`
2. **Global fallback**: `~/.claude/blog/STYLE_GUIDE.md` and `~/.claude/blog/VOICE_REFERENCE.md`

Check project-level first; if missing, use global fallback. If neither exists, proceed without and note absence.

---

## Actions

| Action        | Trigger                             | Description                          |
| ------------- | ----------------------------------- | ------------------------------------ |
| `plan`        | "plan blog post", "new blog series" | Plan post or series                  |
| `research`    | "research blog", "develop outline"  | Research and outline                 |
| `draft`       | "draft blog", "write post"          | Write first draft                    |
| `critique`    | "critique draft", "review blog"     | Adversarial review                   |
| `deformulize` | "deformulize", "vary patterns"      | Identify and vary formulaic patterns |
| `cleanup`     | "commit blog changes"               | Commit modified blog files           |
| `editorial-review` | "editorial review", "voice check", "style check" | Parallel voice/style compliance check |
| `audit`       | "audit blog", "content audit", "audit series" | Batch analysis across posts          |

**IMPORTANT — Auto-commit rule:** After any write action (plan, research, draft, critique `--chain`,
deformulize, editorial-review `--fix`) completes and passes verification, ALWAYS run the Cleanup
step, commit, and push before returning to the user. Do not wait for the user to request a commit.
This is mandatory, not optional.

---

## Plan

**Input**: Topic/title, `series: {concept}`, `--series={name}`, "list", or empty

**Structure**: `_blog/{series-name}/` with subdirs: `outlines/`, `drafts/`, `research/`

**For new series**:
1. Read style guide (project-level, fallback to global)
2. Review existing series plans
3. Create `{series}/series-plan.md` with: concept, audience, tone, template, posts, cadence

**For single post**:
1. Determine series
2. Define: title, thesis, audience, type, length
3. Create outline in `{series}/outlines/{post-slug}.md`
4. Check conflicts with existing outlines

---

## Research

**Input**: Outline path, slug/title, `--series={name}`, `--deep`, or empty

**Steps**:
1. Locate/create outline
2. Read context (series plan, style guide, related posts)
3. Conduct research:
   - **Primary**: Official docs, papers, specs
   - **Secondary**: Blogs, talks, GitHub
   - **Original**: Run tests, gather data, check pricing
4. Develop outline with key points, evidence, word counts
5. Document sources in `## References & Resources`
6. If extensive, save to `{series}/research/{topic}.md`

**Outline must include**: Hook, thesis, section breakdown, conclusion, CTA.

---

## Draft

**Input**: Outline path, slug/title, `--continue`, `--section={name}`, or empty

**CRITICAL**: Read voice reference (see Guide Resolution) before writing ANY content. Apply all voice rules, anti-patterns, and tone guidance throughout.

**Draft Structure**:
```markdown
# [Title with Specifics]
> [One-sentence hook]
**TL;DR**: [2-3 sentences]
---
## Introduction
## Section 1: [Title]
## Conclusions
---
## References
```

**Required Elements**:
- Technical posts: Test Environment (hardware, software, methodology, limitations)
- Code examples with reproducible commands
- Tables for data, clear section breaks

**Self-Review**: Run quick checklist from voice reference guide.

Save to `{series}/drafts/{slug}.md`.

---

## Critique

**Input**: Draft path, slug/title, `--style`, `--technical`, `--engagement`, `--final`

**Review Areas**:

| Area       | Check                                                   |
| ---------- | ------------------------------------------------------- |
| Style      | Voice matches guide, jargon defined, data-first, format |
| Technical  | Claims correct, methodology, sources, limitations       |
| Engagement | Hook, flow, transitions, paragraphs, skimmability       |
| Editorial  | Title, evidence, code, links, length                    |

**Scoring**: 9-10 publish-ready, 7-8 targeted improvements, 5-6 significant revision, <5 structural issues.

**Provide**: Section analysis, rewrites, action items, publish readiness.

**Chaining** (`--chain`): After critique, auto-apply non-structural fixes:
1. Fix factual errors, broken links, formatting issues
2. Apply suggested rewrites for issues scored < 7
3. Commit and push via SHARED/commit-framework.md (prefix: `docs(blog)`)
4. Output: what was fixed vs what needs human judgment

Default (no flag): output critique only. See `references/critique.md` for detailed rubric.

---

## Deformulize

**Input**: Draft path, slug/title, `--series` (analyze full series), `--structure`, `--openings`, `--closings`, or empty

**Formulaic Patterns to Detect**:

| Pattern              | Example                                  | Problem                       |
| -------------------- | ---------------------------------------- | ----------------------------- |
| Three-act skeleton   | Promise/Catch/Conclusions in every post  | Predictable                   |
| Boilerplate headers  | "The Glory Days", "The Promise"          | Generic, not content-specific |
| Press-release TL;DRs | "X promised Y but delivered Z"           | Marketing tone                |
| Formulaic closings   | "In my next post..." + series footer     | TV cliffhanger                |
| Defensive sections   | "Addressing Skepticism" + quote/rebuttal | Pre-defending absent critics  |

**Note**: Keep blockquote hook + TL;DR (good for SEO/summarization) but vary content within. Remove "Reading time" (platforms auto-calculate).

**Steps**:
1. Analyze current state: opening, structure, closing patterns
2. Compare across series (if `--series`): identical headers, structural variations that work
3. Generate 2-3 variations per formulaic element:
   - **Headers**: Content-specific ("The Promise" -> "Why Oracle loved bitmap indexes")
   - **TL;DRs**: Question + conclusion format, 280 chars target, 512 max
   - **Closings**: Open question, CTA, or implication instead of "In my next post..."
4. Suggest alternative structures: Timeline, Competitive, Technical Evolution, Market Dynamics, Decision Framework
5. Provide concrete rewrites for the most formulaic elements

**Principles**: Vary don't eliminate; content-specific beats generic; structure serves content; trust the reader.

---

## Editorial Review

**Input**: Draft path, slug/title, `--series` (check all drafts in a series), `--fix` (auto-apply non-ambiguous fixes)

Differs from critique: fast, focused voice/anti-pattern lint (pass/fail checklist) vs. comprehensive scored review.

**Steps**:
1. Resolve voice reference and style guide (see Guide Resolution)
2. Launch `general-purpose` subagent (model: `haiku`) with prompt from `references/editorial-review.md`
3. Subagent reads draft + both guides, runs checklist, returns structured report
4. If `--series`: one subagent per draft, aggregate results
5. If `--fix`: apply non-ambiguous fixes (word replacements, passive->active, remove markers). Do NOT fix items requiring creative judgment.

See `references/editorial-review.md` for the full checklist and subagent prompt.

---

## Audit

**Input**: `--series={name}`, `--tier={2|3|4}`, `--all`, or specific file list

Differs from critique: operates across many posts for cross-post patterns (inconsistent voice, missing frontmatter, orphaned footnotes, placeholders, structural repetition).

**Steps**:
1. Resolve scope (see reference for scope resolution table)
2. Discover files via Glob, read each post
3. Per-post checks: frontmatter, status, placeholders, orphaned footnotes/links, empty sections, word count
4. Cross-post checks (series/batch only): duplicate titles, numbering, structural repetition, hook/TL;DR/closing repetition, voice drift
5. Generate report: errors, warnings, info, recommendations

**Output**: Aggregate report grouped by severity (errors -> warnings -> cross-post patterns -> info).

See `references/audit.md` for the full check list and report format.

---

## Cleanup

Uses SHARED/commit-framework.md with:
- **file_scope**: `git status --porcelain _blog/`
- **prefix**: `docs(blog)`
- **verify_cmd**: Check markdown links resolve, YAML frontmatter valid, no unintentional `TODO`/`TBD`/`XXX` markers

**Categories** for commit scope: Outlines (plans, structures), Drafts (first drafts, revisions), Research (notes, sources), Style (guide updates, templates), Series (new series plans).

**Examples**: `docs(blog): add draft for bitmap index deep-dive`, `docs(blog): update series plan with new post schedule`

**Output**: List files committed with series/type, commit hash, and message.
