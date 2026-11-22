---
name: blog
description: Use when the user asks to "plan a blog post", "research for blog", "draft a blog post", "critique a draft", "deformulize a post", "commit blog changes", "editorial review", "voice check", "style check", "audit blog", "content audit", "audit series", or "audit drafts".
version: 0.6.0
tools: Bash, Read, Write, Edit, Agent, Glob, Grep
---

# Blog Workflow

Route the request below. Resolve voice before drafting or editing.

## Guides

Where posts, outlines, and research live is set by the project's blog layout
document (`_blog/README.md`) when one exists. Default layout is stage-first:
`drafts/{series}/`, `outlines/{series}/`, `research/{series}/`.

Read project `_blog/STYLE_GUIDE.md` and `_blog/VOICE_REFERENCE.md` when they
exist. If they exist, do not load `~/.claude/blog/*`. If they do not exist,
read global `~/.claude/blog/*`. If neither exists, proceed and note the gap.

## Critical rules

- Repository writes, including `cleanup`, go through
  `shared-change-framework/SKILL.md` Section 4 with prefix `docs(blog)`.
- `critique`, `editorial-review`, `audit`, and `deformulize` follow
  `shared-review-protocol/SKILL.md` [REVIEW-AUTH-001]. After findings,
  `critique`, `editorial-review`, and `audit` apply its L2 audit.
- Prefer official or primary sources. Cite research notes, verify unstable
  facts, and never invent results, prices, quotes, benchmarks, or facts.

## Actions

| Action | Trigger | Read |
|---|---|---|
| `plan` | plan a post/new series | `references/plan.md` |
| `research` | research/develop outline | `references/research.md` |
| `draft` | draft/write post | `references/draft.md` |
| `critique` | critique/review blog | `references/critique.md` |
| `deformulize` | deformulize/vary patterns | `references/deformulize.md` |
| `editorial-review` | editorial/voice/style check | `references/editorial-review.md` |
| `audit` | audit blog/series/drafts | `references/audit.md` |
| `cleanup` | commit blog changes | `references/cleanup.md` |
| `help` | help/list actions | this table |
