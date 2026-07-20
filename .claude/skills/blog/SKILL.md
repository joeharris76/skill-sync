---
name: blog
description: Use when the user asks to "plan a blog post", "research for blog", "draft a blog post", "critique a draft", "deformulize a post", "commit blog changes", "editorial review", "voice check", "style check", "audit blog", "content audit", "audit series", or "audit drafts".
version: 0.5.0
tools: Bash, Read, Write, Edit, Agent, Glob, Grep
---

# Blog Workflow

Route the request to one action below. Resolve voice before drafting or
editing.

## Guides

Read project `_blog/STYLE_GUIDE.md` and `_blog/VOICE_REFERENCE.md` first, then
global `~/.claude/blog/*`. If neither exists, proceed and note the gap.

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

## Global rules

- Write actions use `SHARED/commit-framework/SKILL.md` with prefix `docs(blog)`
  after verification and cleanup.
- Plain `critique`, `editorial-review`, `audit`, and `deformulize` are
  read-only under `SHARED/review-protocol/SKILL.md`; `--chain`/`--fix` may
  apply only the fixes allowed by the action reference. After findings,
  `critique`, `editorial-review`, and `audit` apply its L2 audit.
- Use official/primary sources when possible, cite research notes, and verify
  unstable facts. Never invent results, pricing, quotes, benchmarks, or facts.
