import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import fastGlob from "fast-glob";
import ignoreFactory from "ignore";
import picomatch from "picomatch";
import {
  DEFAULT_IGNORE,
  type BsprettierConfig,
} from "../config.js";

export function discoverFiles(
  globs: string[],
  config: BsprettierConfig,
  cwd: string,
): string[] {
  const patterns = globs.length > 0 ? globs : config.include;
  const ignorePatterns = [...DEFAULT_IGNORE, ...config.ignore];
  let entries = fastGlob.sync(patterns, {
    cwd,
    absolute: true,
    ignore: ignorePatterns,
    dot: false,
    onlyFiles: true,
  });

  // fast-glob's `ignore` is matched relative to cwd and silently does nothing
  // for globs that reach outside cwd (e.g. `../../app/**`). Post-filter the
  // absolute paths so `**/...`-style ignore patterns apply regardless of where
  // the target lives. (fast-glob's own filtering still prunes the in-cwd case.)
  const isIgnored = picomatch(ignorePatterns, { dot: true });
  entries = entries.filter((abs) => !isIgnored(abs));

  // Apply .gitignore if present.
  const gitignorePath = resolve(cwd, ".gitignore");
  if (existsSync(gitignorePath)) {
    const ig = ignoreFactory().add(readFileSync(gitignorePath, "utf8"));
    return entries.filter((abs) => {
      const rel = relative(cwd, abs);
      if (rel.startsWith("..") || isAbsolute(rel)) return true;
      return rel.length > 0 && !ig.ignores(rel);
    });
  }
  return entries;
}
