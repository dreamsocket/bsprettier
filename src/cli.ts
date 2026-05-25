import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import pc from "picocolors";
import {
  loadConfig,
  ruleSetting,
  type BsprettierConfig,
} from "./config.js";
import { ALL_RULE_IDS } from "./rules/registry.js";
import {
  formatFile,
  type FormatFileResult,
} from "./edit/runner.js";
import { formatSingleFileForEditor } from "./editor.js";
import { migrateOnChangeObservers } from "./edit/onchange-migration.js";
import { getProjectContext } from "./project/context.js";
import { discoverFiles } from "./project/discovery.js";

interface CliArgs {
  globs: string[];
  mode: "check" | "write" | "list-different" | "none";
  verbose: boolean;
  progress?: boolean;
  rules?: Set<string>;
  configPath?: string;
  stdinFilepath?: string;
  help: boolean;
}

const USAGE = `bsprettier — formatter for BrightScript, BrighterScript, and SceneGraph XML

Usage:
  bsprettier <glob...> --check
  bsprettier <glob...> --write
  bsprettier <glob...> --list-different
  bsprettier --stdin-filepath <path> < input

Options:
  --check             Exit non-zero if any file would change (prints the list).
  --write             Rewrite files in place.
  --list-different    Like --check but prints only differing paths.
  --rules=<a,b,...>   Restrict the active rule set.
  --config <path>     Explicit config file path.
  --stdin-filepath <p> Read stdin, write formatted text to stdout.
  --verbose           Per-rule summary in --check output.
  --progress          Force progress output to stderr.
  --no-progress       Disable automatic progress output.
  --help              Show this message.

Exit codes: 0 clean/written, 1 --check found changes, 2 parse/conflict error,
3 CLI usage error.`;

function parseArgs(argv: string[]): CliArgs | { usageError: string } {
  const args: CliArgs = {
    globs: [],
    mode: "none",
    verbose: false,
    help: false,
  };
  let modeCount = 0;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--check") {
      args.mode = "check";
      modeCount++;
    } else if (arg === "--write") {
      args.mode = "write";
      modeCount++;
    } else if (arg === "--list-different") {
      args.mode = "list-different";
      modeCount++;
    } else if (arg === "--verbose") {
      args.verbose = true;
    } else if (arg === "--progress") {
      args.progress = true;
    } else if (arg === "--no-progress") {
      args.progress = false;
    } else if (arg.startsWith("--rules=")) {
      args.rules = new Set(
        arg
          .slice("--rules=".length)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (arg === "--config") {
      const next = argv[++i];
      if (!next) return { usageError: "--config requires a path" };
      args.configPath = next;
    } else if (arg === "--stdin-filepath") {
      const next = argv[++i];
      if (!next) return { usageError: "--stdin-filepath requires a path" };
      args.stdinFilepath = next;
    } else if (arg.startsWith("-")) {
      return { usageError: `unknown option: ${arg}` };
    } else {
      args.globs.push(arg);
    }
  }
  if (modeCount > 1) {
    return {
      usageError: "--check, --write, and --list-different are mutually exclusive",
    };
  }
  if (args.rules) {
    for (const id of args.rules) {
      if (!ALL_RULE_IDS.includes(id)) {
        return { usageError: `unknown rule id: ${id}` };
      }
    }
  }
  return args;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const totalSeconds = Math.ceil(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0
    ? `${hours}h`
    : `${hours}h ${remainingMinutes}m`;
}

class ProgressReporter {
  private completed = 0;
  private readonly startedAt = Date.now();
  private lastRenderedAt = 0;
  private active = false;

  constructor(
    private readonly enabled: boolean,
    private readonly interactive: boolean,
    private readonly total: number,
  ) {}

  begin(detail: string): void {
    if (!this.enabled) return;
    this.active = true;
    this.render(detail, true);
  }

  tick(detail: string): void {
    if (!this.enabled) return;
    this.completed = Math.min(this.completed + 1, this.total);
    this.render(detail, this.completed === this.total);
  }

  finish(detail: string): void {
    if (!this.enabled || !this.active) return;
    this.completed = this.total;
    this.render(detail, true);
    if (this.interactive) process.stderr.write("\n");
    this.active = false;
  }

  clear(): void {
    if (!this.enabled || !this.interactive || !this.active) return;
    process.stderr.write("\r\x1b[K");
    this.lastRenderedAt = 0;
  }

  private render(detail: string, force: boolean): void {
    const now = Date.now();
    const intervalMs = this.interactive ? 100 : 1000;
    if (!force && now - this.lastRenderedAt < intervalMs) return;

    const safeTotal = Math.max(this.total, 1);
    const percent = Math.floor((this.completed / safeTotal) * 100);
    const elapsed = now - this.startedAt;
    const eta =
      this.completed > 0 && this.completed < safeTotal
        ? formatDuration(
            (elapsed / this.completed) * (safeTotal - this.completed),
          )
        : this.completed >= safeTotal
          ? "0s"
          : "?";
    const message =
      `Progress ${this.completed}/${safeTotal} (${percent}%) ` +
      `elapsed ${formatDuration(elapsed)} eta ${eta} ${pc.dim(detail)}`;

    if (this.interactive) {
      process.stderr.write(`\r${message}\x1b[K`);
    } else {
      process.stderr.write(`${message}\n`);
    }
    this.lastRenderedAt = now;
  }
}

function shouldUseProgress(args: CliArgs): boolean {
  return args.progress ?? process.stderr.isTTY === true;
}

function addRuleIds(
  ruleIdsByFile: Map<string, Set<string>>,
  filePath: string,
  ruleIds: string[],
): void {
  if (ruleIds.length === 0) return;
  let existing = ruleIdsByFile.get(filePath);
  if (!existing) {
    existing = new Set<string>();
    ruleIdsByFile.set(filePath, existing);
  }
  for (const ruleId of ruleIds) existing.add(ruleId);
}

function shouldRunOnChangeMigration(
  config: BsprettierConfig,
  onlyRules: Set<string> | undefined,
): boolean {
  if (onlyRules && !onlyRules.has("xml/no-onchange-field")) return false;
  const setting = ruleSetting(config, "xml/no-onchange-field");
  return setting !== "off" && setting !== "info";
}

function configErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if ("usageError" in parsed) {
    process.stderr.write(`${pc.red("error")}: ${parsed.usageError}\n\n${USAGE}\n`);
    return 3;
  }
  const args = parsed;
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const cwd = process.cwd();

  // Stdin mode.
  if (args.stdinFilepath) {
    const source = await readStdin();
    let result: FormatFileResult;
    try {
      result = formatSingleFileForEditor({
        filePath: args.stdinFilepath,
        source,
        configPath: args.configPath,
        cwd,
        onlyRules: args.rules,
      });
    } catch (err) {
      process.stderr.write(
        `${pc.red("error")}: config error: ${configErrorMessage(err)}\n`,
      );
      return 3;
    }
    if (result.status === "parse-error" || result.status === "conflict") {
      process.stderr.write(
        `${pc.red("error")}: ${result.errorMessage ?? result.status}\n`,
      );
      process.stdout.write(source);
      return 2;
    }
    process.stdout.write(result.output);
    return 0;
  }

  if (args.globs.length === 0 && args.mode === "none") {
    process.stderr.write(`${pc.red("error")}: no input files\n\n${USAGE}\n`);
    return 3;
  }

  let config: BsprettierConfig;
  try {
    config = loadConfig({ configPath: args.configPath, searchFrom: cwd });
  } catch (err) {
    process.stderr.write(
      `${pc.red("error")}: config error: ${configErrorMessage(err)}\n`,
    );
    return 3;
  }
  const files = discoverFiles(args.globs, config, cwd);

  if (files.length === 0) {
    process.stderr.write(`${pc.yellow("warning")}: no matching files\n`);
    return 0;
  }

  let hadError = false;
  const initialSources = new Map<string, string>();
  const erroredFiles = new Set<string>();
  const runsMigration = shouldRunOnChangeMigration(config, args.rules);
  const progressTotal = files.length * 3 + (runsMigration ? 1 : 0);
  const progress = new ProgressReporter(
    shouldUseProgress(args),
    process.stderr.isTTY === true,
    progressTotal,
  );

  progress.begin(`discovered ${files.length} file(s)`);

  for (const filePath of files) {
    try {
      initialSources.set(filePath, readFileSync(filePath, "utf8"));
    } catch (err) {
      progress.clear();
      process.stderr.write(
        `${pc.red("error")}: cannot read ${filePath}: ${String(err)}\n`,
      );
      hadError = true;
      erroredFiles.add(filePath);
    }
    progress.tick(`read ${relative(cwd, filePath)}`);
  }

  const migration = runsMigration
    ? migrateOnChangeObservers(initialSources)
    : {
        sources: new Map(initialSources),
        changedRuleIdsByFile: new Map<string, Set<string>>(),
      };
  if (runsMigration) progress.tick("migrated onChange observers");
  const currentSources = migration.sources;
  const formatProjectSources = new Map(currentSources);
  const formatProjectContext = getProjectContext(formatProjectSources);
  const changedRuleIdsByFile = migration.changedRuleIdsByFile;
  const changedFiles: FormatFileResult[] = [];

  for (const filePath of files) {
    const source = currentSources.get(filePath);
    if (source === undefined) {
      progress.tick(`skipped ${relative(cwd, filePath)}`);
      continue;
    }
    const result = formatFile({
      filePath,
      source,
      config,
      projectSources: formatProjectSources,
      projectContext: formatProjectContext,
      onlyRules: args.rules,
    });

    for (const d of result.diagnostics) {
      const sev =
        d.severity === "error"
          ? pc.red("error")
          : d.severity === "warn"
            ? pc.yellow("warn")
            : pc.cyan("info");
      progress.clear();
      process.stderr.write(
        `${sev} ${pc.dim(d.ruleId)} ${relative(cwd, filePath)}: ${d.message}\n`,
      );
    }

    if (result.status === "parse-error" || result.status === "conflict") {
      progress.clear();
      process.stderr.write(
        `${pc.red("error")} ${relative(cwd, filePath)}: ${result.errorMessage ?? result.status}\n`,
      );
      hadError = true;
      erroredFiles.add(filePath);
      progress.tick(`formatted ${relative(cwd, filePath)}`);
      continue;
    }

    if (result.changed) {
      currentSources.set(filePath, result.output);
      addRuleIds(changedRuleIdsByFile, filePath, result.ruleIds);
    }
    progress.tick(`formatted ${relative(cwd, filePath)}`);
  }

  for (const filePath of files) {
    if (erroredFiles.has(filePath)) {
      progress.tick(`skipped ${relative(cwd, filePath)}`);
      continue;
    }
    const initial = initialSources.get(filePath);
    const current = currentSources.get(filePath);
    if (initial === undefined || current === undefined || current === initial) {
      progress.tick(`checked ${relative(cwd, filePath)}`);
      continue;
    }
    const ruleIds = [...(changedRuleIdsByFile.get(filePath) ?? [])].sort();
    changedFiles.push({
      filePath,
      status: "changed",
      output: current,
      changed: true,
      diagnostics: [],
      ruleIds,
    });

    if (args.mode === "write") {
      try {
        writeFileSync(filePath, current, "utf8");
      } catch (err) {
        progress.clear();
        process.stderr.write(
          `${pc.red("error")}: cannot write ${filePath}: ${String(err)}\n`,
        );
        hadError = true;
      }
    }
    progress.tick(
      args.mode === "write"
        ? `wrote ${relative(cwd, filePath)}`
        : `checked ${relative(cwd, filePath)}`,
    );
  }
  progress.finish(`processed ${files.length} file(s)`);

  const changedCount = changedFiles.length;

  // Reporting.
  if (args.mode === "write") {
    process.stdout.write(
      `${pc.green("formatted")} ${changedCount} file(s); ${files.length} checked\n`,
    );
    return hadError ? 2 : 0;
  }

  if (args.mode === "check" || args.mode === "list-different") {
    for (const r of changedFiles) {
      const rel = relative(cwd, r.filePath);
      if (args.mode === "list-different") {
        process.stdout.write(`${rel}\n`);
      } else if (args.verbose) {
        process.stdout.write(`${rel}: ${r.ruleIds.join(", ")}\n`);
      } else {
        process.stdout.write(`${rel}\n`);
      }
    }
    if (hadError) return 2;
    return changedCount > 0 ? 1 : 0;
  }

  // No mode flag: behave like --check without failing semantics differences.
  for (const r of changedFiles) {
    process.stdout.write(`${relative(cwd, r.filePath)}\n`);
  }
  if (hadError) return 2;
  return changedCount > 0 ? 1 : 0;
}
