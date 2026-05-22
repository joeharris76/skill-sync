---
name: blog
description: Use when the user asks to "plan a blog post", "research for blog", "draft a blog post", "critique a draft", "deformulize a post", "commit blog changes", "editorial review", "voice check", "style check", "audit blog", "content audit", "audit series", or "audit drafts".
version: 0.5.0
tools: Bash, Read, Write, Edit, Agent, Glob, Grep
---

# Blog Workflow

Plan, research, draft, critique, polish, audit, and commit blog work.

## Guides

Resolve style/voice in order: project `_blog/STYLE_GUIDE.md` + `_blog/VOICE_REFERENCE.md`, then global `~/.claude/blog/*`. If neither exists, proceed and note the gap. Drafting must read the voice reference first.

## Actions

| Action | Trigger | Contract |
|---|---|---|
| `plan` | "plan blog post", "new blog series" | Create outline or series plan |
| `research` | "research blog", "develop outline" | Build evidence-backed outline/research notes |
| `draft` | "draft blog", "write post" | Write or continue draft using voice guide |
| `critique` | "critique draft", "review blog" | Adversarial editorial/technical review |
| `deformulize` | "deformulize", "vary patterns" | Detect and vary formulaic structure/language |
| `editorial-review` | "editorial review", "voice check", "style check" | Fast voice/style compliance pass |
| `audit` | "audit blog", "content audit", "audit series" | Batch review posts/series for patterns and gaps |
| `cleanup` | "commit blog changes" | Validate and commit blog files |
| `help` | "help", "list actions" | Show actions |

## Hard Rules

- Write actions auto-cleanup after verification; use SHARED/commit-framework/SKILL.md with prefix `docs(blog)`.
- Plain `critique`, `editorial-review`, `audit`, and `deformulize` without `--chain`/`--fix` are read-only under SHARED/review-protocol/SKILL.md; after findings, `critique`/`editorial-review`/`audit` apply its L2 audit.
- Use official/primary sources for claims when possible; cite research notes.
- Do not invent results, pricing, quotes, benchmarks, or external facts; verify current facts when unstable.

## Action Notes

- **Plan:** single post -> define thesis, audience, type, length, outline path. Series -> create `{series}/series-plan.md` with concept, audience, tone, template, posts, cadence. Before committing thesis/audience/outline, apply plan-deepening L3; note any thesis reframe.
- **Research:** read outline, series plan, style guide, related posts; gather primary/secondary/original evidence; update outline and save substantial notes under `{series}/research/`. When findings change the outline or thesis, apply plan-deepening L3 before updating.
- **Draft:** save to `{series}/drafts/{slug}.md`; include title, hook, TL;DR when appropriate, sectioned argument, reproducible commands/data for technical posts, references.
- **Critique:** evaluate style, technical accuracy, methodology, sources, limitations, hook, flow, title, evidence, links, length. Score 9-10 publish-ready, 7-8 targeted, 5-6 significant, <5 structural. See `references/critique.md`.
- **Critique --chain:** apply non-structural fixes only; leave thesis/positioning changes for user judgment; commit when verified.
- **Deformulize:** flag repeated openings, section skeletons, transitions, closings, generic headings, and predictable cadence; suggest specific alternatives.
- **Editorial-review:** produce pass/fail checklist for voice, banned patterns, clarity, title, claims, links, and formatting. Optional subagent prompt should be generated from this checklist.
- **Audit:** scan one series or corpus for stale claims, repeated structures, missing links, weak posts, source gaps, and publication readiness; output findings and recommended fixes.
- **Cleanup:** commit only modified blog files and report files, commit hash, and remaining human decisions.
