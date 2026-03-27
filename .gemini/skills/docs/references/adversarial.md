# Adversarial Review Reference

Review docs from a skeptical user's perspective.

## Personas

| Persona | Goal | Key Pages |
|---------|------|-----------|
| `new-user` | Install, run first benchmark | quickstart, installation, CLI |
| `developer` | Add platform adapter | development, architecture, API |
| `ops` | Debug production issue | troubleshooting, CLI, platforms |
| `contributor` | Understand codebase | architecture, development, testing |
| `evaluator` | Assess fit | features, benchmarks, platforms |

## Process

1. **Define Perspective**: Parse persona, identify goal, list pages to visit
2. **Challenge Assumptions**: Prerequisites sufficient? Examples work? Errors documented? Jargon explained?
3. **Test Journeys**: Follow steps exactly, note confusion, identify missing steps, check links
4. **Identify Gaps**: Missing edge cases, undocumented errors, implicit knowledge, broken examples
5. **Verify Claims**: Test CLI commands (dry-run), verify performance claims, check compatibility
6. **Assess Friction**: Where would user give up? What requires external research? What's ambiguous?

## Adversarial Questions

- **New Users**: Install in <5 min? Run first benchmark without help? Understanding or just copying?
- **Developers**: Can find needed API? Extension points documented? Architecture clear?
- **Ops**: Debug without source code? Errors documented with solutions? Runbook for common issues?

## Report Format

```markdown
## Adversarial Review

### Perspective
- **Persona**: {type}
- **Goal**: {goal}

### Journey
| Step | Page | Outcome | Friction |
|------|------|---------|----------|
| 1 | install.rst | Blocked | Missing Python version |

### Issues
| Severity | Location | Issue | Fix |
|----------|----------|-------|-----|
| Critical | install:15 | Python version missing | Add "Requires 3.10+" |

### Friction Points
| Page | Point | Impact | Fix |
|------|-------|--------|-----|
| quickstart | Step 3 | High | Explain what "scale factor" means |

### Missing Docs
| Topic | Why Needed | Priority |
|-------|------------|----------|
| Error codes | Debug issues | High |

### Risk Assessment
- **Abandonment Risk**: [High/Medium/Low]
- **Support Burden**: [High/Medium/Low]
```

## Quality Criteria

| Aspect | Excellent | Needs Work |
|--------|-----------|------------|
| Accuracy | All examples work | Outdated content |
| Completeness | All features covered | Major gaps |
| Clarity | Easy to follow | Hard to understand |
| Findability | Clear navigation | Hard to discover |
