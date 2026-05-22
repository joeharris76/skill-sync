import { homedir } from "node:os";
import { join, resolve } from "node:path";

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
