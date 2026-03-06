import { readFileSync } from "node:fs";
import { projectPath } from "./module-availability.js";

export function readFixture(...segments: string[]): string {
  return readFileSync(projectPath("tests", "fixtures", ...segments), "utf8");
}

