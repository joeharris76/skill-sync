import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Expand a leading `~` (home) in a manifest-supplied path.
 *
 * `~` and `~/...` expand to the user's home directory; everything else
 * (absolute paths, relative paths, and `~user` forms) is returned unchanged.
 * Manifest source/target paths are commonly written with `~` for portability,
 * so they must be expanded before being resolved against any base directory.
 */
export function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/**
 * Resolve a manifest-supplied path against `base`, expanding a leading `~`
 * first.
 *
 * Behavior after expansion mirrors {@link resolve}: a `~`-rooted or absolute
 * path resolves to itself regardless of `base`; a relative path resolves
 * against `base`. This prevents `resolve(base, "~/x")` from producing a literal
 * `~` path segment under `base` (the cause of junk `<base>/~/...` directories).
 */
export function resolvePath(base: string, p: string): string {
  return resolve(base, expandTilde(p));
}

/**
 * Convert an absolute path to a `~`-relative form when it lives under the home
 * directory; otherwise return it unchanged.
 *
 * Inverse of {@link expandTilde}. Used to keep machine-specific home paths out
 * of committed files (lock provenance, the downstream project registry) so a
 * tracked snapshot doesn't leak one developer's filesystem layout.
 */
export function toTildePath(absPath: string): string {
  const home = homedir();
  if (absPath === home) return "~";
  if (absPath.startsWith(`${home}${sep}`)) return `~/${absPath.slice(home.length + 1)}`;
  return absPath;
}

/**
 * Compute the POSIX-style path of a manifest-supplied target relative to
 * `projectRoot`, or `null` if it resolves outside the project tree.
 *
 * Used to anchor `.gitignore`/`.gitattributes` entries (which must be relative
 * to the file's directory) and to reject committing targets that live outside
 * the repo (e.g. `~/.claude/skills`). The target may be relative, absolute, or
 * `~`-rooted; the result is always forward-slashed and never starts with `..`.
 */
export function relativeInside(projectRoot: string, target: string): string | null {
  const root = resolve(projectRoot);
  const abs = resolvePath(projectRoot, target);
  const rel = relative(root, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}
