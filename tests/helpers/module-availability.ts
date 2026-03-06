import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");

export function projectPath(...segments: string[]): string {
  return resolve(projectRoot, ...segments);
}

export function moduleExists(relativePath: string): boolean {
  return existsSync(projectPath(relativePath));
}

