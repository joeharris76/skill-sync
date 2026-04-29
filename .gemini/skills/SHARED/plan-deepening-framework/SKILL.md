---
name: plan-deepening-framework
description: Three-layer planning review framework for challenging obvious answers, surfacing blind spots, and reframing problems.
---

# Plan Deepening Framework

Three questions to run before committing to a plan or interpretation.

## Layer 1 — What's the obvious answer?
State the obvious solution or finding before questioning it.

## Layer 2 — What am I missing? *(post-findings)*
- What class of issue does my framework fail to catch for this type of change/bug/decision?
- What would a domain expert notice that this framework misses?
- What assumption am I making about how this code/system is used in production?

## Layer 3 — What question should I actually be asking? *(pre-commit)*
- Is the stated problem the actual constraint, or a symptom of something upstream? Would a different approach serve the underlying need better?
- If I had to defend why this is the right problem to solve, what would I say?

**If L3 produces a reframe**: document it before proceeding.
