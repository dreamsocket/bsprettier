import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { vi } from "vitest";

export interface TempProjectContext {
  root: string;
  read(relPath: string): string;
  stdoutText(): string;
  stderrText(): string;
}

export interface TempProjectOptions {
  files: Record<string, string>;
  /** Subdirectory of `root` to chdir into. Defaults to `root` itself. */
  cwd?: string;
}

const originalCwd = process.cwd();

export async function withTempProject(
  options: TempProjectOptions,
  fn: (ctx: TempProjectContext) => Promise<void> | void,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "bsprettier-cli-"));

  for (const [relPath, contents] of Object.entries(options.files)) {
    const absPath = join(root, relPath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, contents, "utf8");
  }

  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  const ctx: TempProjectContext = {
    root,
    read: (relPath) => readFileSync(join(root, relPath), "utf8"),
    stdoutText: () => stdout.mock.calls.map(([chunk]) => String(chunk)).join(""),
    stderrText: () => stderr.mock.calls.map(([chunk]) => String(chunk)).join(""),
  };

  try {
    process.chdir(options.cwd ? join(root, options.cwd) : root);
    await fn(ctx);
  } finally {
    process.chdir(originalCwd);
    rmSync(root, { recursive: true, force: true });
  }
}
