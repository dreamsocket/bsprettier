import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import fastGlob from "fast-glob";
import ignoreFactory from "ignore";
import pc from "picocolors";
import {
  loadConfig,
  DEFAULT_IGNORE,
  ruleSetting,
  type BsprettierConfig,
} from "./config.js";
import { ALL_RULE_IDS } from "./rules/registry.js";
import {
  formatFile,
  type FormatFileResult,
} from "./edit/runner.js";
import { migrateOnChangeObservers } from "./edit/onchange-migration.js";

interface CliArgs {
  globs: string[];
  mode: "check" | "write" | "list-different" | "none";
  verbose: boolean;
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

function discoverFiles(
  globs: string[],
  config: BsprettierConfig,
  cwd: string,
): string[] {
  const patterns = globs.length > 0 ? globs : config.include;
  const ignorePatterns = [...DEFAULT_IGNORE, ...config.ignore];
  const entries = fastGlob.sync(patterns, {
    cwd,
    absolute: true,
    ignore: ignorePatterns,
    dot: false,
    onlyFiles: true,
  });

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
    const config = loadConfig({
      configPath: args.configPath,
      searchFrom: resolve(cwd, args.stdinFilepath),
    });
    const source = await readStdin();
    const result = formatFile({
      filePath: args.stdinFilepath,
      source,
      config,
      onlyRules: args.rules,
    });
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

  const config = loadConfig({ configPath: args.configPath, searchFrom: cwd });
  const files = discoverFiles(args.globs, config, cwd);

  if (files.length === 0) {
    process.stderr.write(`${pc.yellow("warning")}: no matching files\n`);
    return 0;
  }

  let hadError = false;
  const initialSources = new Map<string, string>();
  const erroredFiles = new Set<string>();

  for (const filePath of files) {
    try {
      initialSources.set(filePath, readFileSync(filePath, "utf8"));
    } catch (err) {
      process.stderr.write(
        `${pc.red("error")}: cannot read ${filePath}: ${String(err)}\n`,
      );
      hadError = true;
      erroredFiles.add(filePath);
    }
  }

  const migration = shouldRunOnChangeMigration(config, args.rules)
    ? migrateOnChangeObservers(initialSources)
    : {
        sources: new Map(initialSources),
        changedRuleIdsByFile: new Map<string, Set<string>>(),
      };
  const currentSources = migration.sources;
  const changedRuleIdsByFile = migration.changedRuleIdsByFile;
  const changedFiles: FormatFileResult[] = [];

  for (const filePath of files) {
    const source = currentSources.get(filePath);
    if (source === undefined) continue;
    const result = formatFile({
      filePath,
      source,
      config,
      projectSources: currentSources,
      onlyRules: args.rules,
    });

    for (const d of result.diagnostics) {
      const sev =
        d.severity === "error"
          ? pc.red("error")
          : d.severity === "warn"
            ? pc.yellow("warn")
            : pc.cyan("info");
      process.stderr.write(
        `${sev} ${pc.dim(d.ruleId)} ${relative(cwd, filePath)}: ${d.message}\n`,
      );
    }

    if (result.status === "parse-error" || result.status === "conflict") {
      process.stderr.write(
        `${pc.red("error")} ${relative(cwd, filePath)}: ${result.errorMessage ?? result.status}\n`,
      );
      hadError = true;
      erroredFiles.add(filePath);
      continue;
    }

    if (result.changed) {
      currentSources.set(filePath, result.output);
      addRuleIds(changedRuleIdsByFile, filePath, result.ruleIds);
    }
  }

  for (const filePath of files) {
    if (erroredFiles.has(filePath)) continue;
    const initial = initialSources.get(filePath);
    const current = currentSources.get(filePath);
    if (initial === undefined || current === undefined || current === initial) {
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
        process.stderr.write(
          `${pc.red("error")}: cannot write ${filePath}: ${String(err)}\n`,
        );
        hadError = true;
      }
    }
  }

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
