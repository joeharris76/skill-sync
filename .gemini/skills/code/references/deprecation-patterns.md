# Deprecation Patterns Reference

Every line of code has ongoing cost (tests, docs, security, mental overhead). Deprecation removes code that no longer earns its keep.

## Decision Checklist

Before deprecating, answer:

1. **Still provides unique value?** Yes -> maintain it. No -> continue.
2. **How many consumers?** Quantify migration scope.
3. **Replacement exists?** No -> build it first. Never deprecate without an alternative.
4. **Migration cost per consumer?** Automatable -> do it. High-effort -> weigh against maintenance cost.
5. **Cost of NOT deprecating?** Security risk, engineer time, complexity drag.

## Advisory vs. Compulsory

| Type | When | Mechanism |
|------|------|-----------|
| Advisory | Old system stable, migration optional | Warnings + docs. Users migrate on own timeline. |
| Compulsory | Security risk, blocks progress, unsustainable cost | Hard deadline + migration tooling + support. |

Default to advisory.

## Migration Patterns

- **Strangler:** Run old/new in parallel, route incrementally (0% -> 100%), remove old at 0%.
- **Adapter:** Translate old interface to new implementation. Consumers keep old API while backend migrates.
- **Feature Flag:** Switch consumers one at a time via flags.

## Zombie Code

Code nobody owns but everybody depends on. Signs: no commits 6+ months, no maintainer, failing tests unfixed, vulnerable deps unpatched.

**Response:** Assign an owner or deprecate with a concrete plan. No limbo.

## Key Principles

- **Owner migrates users.** If you own the infra being deprecated, you own the migration (or provide backward-compatible updates).
- **Design for removal.** Clean interfaces, feature flags, minimal surface area make future deprecation tractable.
