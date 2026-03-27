# Blog Cleanup Reference

Create cleanup commits for modified blog files.

## Process

1. Find modified files: `git status --porcelain _blog/`
2. If none: exit with "No modified blog files found."
3. Analyze: `git diff _blog/`, read untracked files, categorize by series/type
4. Stage and commit:
   ```bash
   git add _blog/ && git commit -m "$(cat <<'EOF'
   docs(blog): <descriptive message>

   <optional details about series/posts>

   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )"
   ```

## Commit Message Format

`docs(blog): <summary>` — e.g., `add slash-commands tutorial draft`, `revise introducing-oxbow outlines`

## Output Format

```markdown
## Blog Cleanup Complete

**Committed N files:**
- `_blog/series/type/file.md` (new/modified)

**Commit:** `abc1234` docs(blog): <message>
```

## Categories

| Category | Examples |
|----------|----------|
| Outlines | New post plans, updated structures |
| Drafts | First drafts, revisions |
| Research | Notes, source compilations |
| Style | Guide updates, templates |
| Series | New series plans |
