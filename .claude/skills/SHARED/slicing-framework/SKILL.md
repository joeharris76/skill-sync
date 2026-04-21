---
name: slicing-framework
description: "Build multi-file changes in thin vertical slices: implement, test, verify, commit, repeat."
---

# Slicing Framework

Build multi-file changes in thin vertical slices: implement, test, verify, commit, repeat.

## When Required

- Multi-file changes or new features
- Refactoring existing code
- Any time you're tempted to write >100 lines before testing

## Rule 0: Simplicity First

Ask: "What is the simplest thing that could work?"

| Bad | Good |
|-----|------|
| Generic EventBus with middleware for one notification | Simple function call |
| Abstract factory for two similar components | Two components with shared utilities |
| Config-driven form builder for three forms | Three form components |

Three similar lines > premature abstraction. Implement naive-correct first, optimize after tests prove correctness.

## Rule 0.5: Scope Discipline

Touch only what the task requires. Do NOT clean up adjacent code, refactor unmodified files, remove comments you don't understand, or add features not in scope. If you notice improvements, surface them:

```
NOTICED BUT NOT TOUCHING: {issue} -> Want me to create a task?
```

## Slicing Strategies

| Strategy | When | Pattern |
|----------|------|---------|
| **Vertical** (preferred) | Default | One complete path through all layers per slice |
| **Contract-First** | Components develop independently | Define interface -> implement sides -> integrate |
| **Risk-First** | High uncertainty | Riskiest piece first; fail fast before investing |

Each slice delivers working end-to-end functionality.

## The Increment Cycle

```
Implement -> Test -> Verify -> Commit -> Next slice
```

After each increment: all tests pass, build succeeds, types check, new functionality works, change is committed.

## Rules

- One logical thing per increment — don't mix concerns
- Project builds after each increment
- New code disabled by default (feature flags for incomplete work)
- Each increment independently revertable
- Small commits are free; large commits hide bugs
