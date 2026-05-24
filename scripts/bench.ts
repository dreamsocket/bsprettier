/**
 * bsprettier benchmark harness.
 *
 * Mirrors the CLI pipeline (read -> onChange migration -> project context ->
 * format -> write) over a corpus and reports a phase breakdown plus parser
 * call counts, so optimization work (bounded concurrency vs. parse caching)
 * can be driven by data instead of guesswork.
 *
 * The committed corpus is SYNTHETIC: a deterministic generator stamps the
 * templates in bench/templates/ into a gitignored scratch dir. No external
 * project code is committed or required. Pass --corpus=<path> to instead point
 * at a real project locally (never written to); that path is not committed.
 *
 *   npm run bench                      # default: generate ~1200 files, measure
 *   npm run bench -- --files=4000      # larger synthetic corpus
 *   npm run bench -- --corpus=../app   # local real-world spot check (read-only)
 */
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastGlob from "fast-glob";
import { defaultConfig, DEFAULT_IGNORE } from "../src/config.js";
import { formatFile, type FormatFileResult } from "../src/edit/runner.js";
import { migrateOnChangeObservers } from "../src/edit/onchange-migration.js";
import { getProjectContext } from "../src/project/context.js";
import { formatMetrics, resetFormatMetrics } from "../src/parser/metrics.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const TEMPLATE_DIR = join(REPO_ROOT, "bench", "templates");

interface BenchArgs {
  files: number;
  seed: number;
  out: string;
  corpus?: string;
  perRule: boolean;
}

function parseArgs(argv: string[]): BenchArgs {
  const args: BenchArgs = {
    files: 1200,
    seed: 1,
    out: join(REPO_ROOT, ".bench-corpus"),
    perRule: false,
  };
  for (const arg of argv) {
    if (arg.startsWith("--files=")) args.files = Number(arg.slice(8));
    else if (arg.startsWith("--seed=")) args.seed = Number(arg.slice(7));
    else if (arg.startsWith("--out=")) args.out = resolve(arg.slice(6));
    else if (arg.startsWith("--corpus=")) args.corpus = resolve(arg.slice(9));
    else if (arg === "--per-rule") args.perRule = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  if (!Number.isFinite(args.files) || args.files < 1) {
    throw new Error("--files must be a positive integer");
  }
  return args;
}

/** Deterministic PRNG (mulberry32) so a given --seed reproduces the corpus. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAME_PARTS = [
  "Home", "Detail", "Player", "Menu", "Grid", "Row", "Card", "Hero",
  "Search", "Settings", "Profile", "List", "Tile", "Banner", "Modal",
];

/** A generated unit = one component XML plus its linked BRS/BS scripts. */
const TEMPLATE_FILES = [
  "handlers.brs",
  "util.brs",
  "model.bs",
  "component.xml",
] as const;

interface Corpus {
  /** abs path -> source text */
  sources: Map<string, string>;
  /** total bytes across all sources */
  bytes: number;
  /** whether the corpus may be written back to (synthetic only) */
  writable: boolean;
  /** scratch dir to clean up, if any */
  scratch?: string;
}

function loadTemplates(): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of TEMPLATE_FILES) {
    out.set(name, readFileSync(join(TEMPLATE_DIR, name), "utf8"));
  }
  return out;
}

function generateCorpus(args: BenchArgs): Corpus {
  const rand = mulberry32(args.seed);
  const templates = loadTemplates();
  rmSync(args.out, { recursive: true, force: true });
  mkdirSync(args.out, { recursive: true });

  const sources = new Map<string, string>();
  let bytes = 0;
  let unit = 0;
  while (sources.size < args.files) {
    const part = NAME_PARTS[Math.floor(rand() * NAME_PARTS.length)]!;
    const name = `${part}${unit}`;
    const dir = join(args.out, "components", name);
    mkdirSync(dir, { recursive: true });
    for (const tplName of TEMPLATE_FILES) {
      if (sources.size >= args.files) break;
      const fileName = tplName.endsWith(".xml")
        ? `${name}.xml`
        : tplName;
      const text = templates.get(tplName)!.replace(/__NAME__/g, name);
      const abs = join(dir, fileName);
      writeFileSync(abs, text, "utf8");
      sources.set(abs, text);
      bytes += Buffer.byteLength(text, "utf8");
    }
    unit++;
  }
  return { sources, bytes, writable: true, scratch: args.out };
}

function loadExternalCorpus(corpus: string): Corpus {
  const files = fastGlob.sync("**/*.{brs,bs,xml}", {
    cwd: corpus,
    absolute: true,
    ignore: DEFAULT_IGNORE,
    onlyFiles: true,
    dot: false,
  });
  const sources = new Map<string, string>();
  let bytes = 0;
  for (const abs of files) {
    const text = readFileSync(abs, "utf8");
    sources.set(abs, text);
    bytes += Buffer.byteLength(text, "utf8");
  }
  return { sources, bytes, writable: false };
}

function fmtMs(ms: number): string {
  return `${ms.toFixed(1)}ms`;
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const config = defaultConfig();

  const t0 = performance.now();

  // ---- Phase: read (or generate, which includes the disk write of fixtures) --
  const readStart = performance.now();
  const corpus = args.corpus
    ? loadExternalCorpus(args.corpus)
    : generateCorpus(args);
  const readMs = performance.now() - readStart;
  const filePaths = [...corpus.sources.keys()];

  if (filePaths.length === 0) {
    console.error("no files in corpus");
    process.exit(1);
  }

  // ---- Phase: onChange migration (mirrors CLI default, no-onchange = warn) ----
  const migrateStart = performance.now();
  const migration = migrateOnChangeObservers(corpus.sources);
  const migrateMs = performance.now() - migrateStart;
  const currentSources = migration.sources;

  // ---- Phase: project context (built once, as the CLI does) ------------------
  const ctxStart = performance.now();
  const projectSources = new Map(currentSources);
  const projectContext = getProjectContext(projectSources);
  const ctxMs = performance.now() - ctxStart;

  // ---- Phase: format (instrument parser calls here) --------------------------
  resetFormatMetrics();
  formatMetrics.enabled = true;
  formatMetrics.perRule = args.perRule;
  const formatStart = performance.now();
  let changed = 0;
  let errored = 0;
  const changedResults: FormatFileResult[] = [];
  for (const filePath of filePaths) {
    const source = currentSources.get(filePath);
    if (source === undefined) continue;
    const result = formatFile({
      filePath,
      source,
      config,
      projectSources,
      projectContext,
    });
    if (result.status === "parse-error" || result.status === "conflict") {
      errored++;
      continue;
    }
    if (result.changed) {
      changed++;
      changedResults.push(result);
    }
  }
  const formatMs = performance.now() - formatStart;
  formatMetrics.enabled = false;
  formatMetrics.perRule = false;

  // ---- Phase: write (synthetic corpus only; never touch external paths) ------
  let writeMs = 0;
  if (corpus.writable) {
    const writeStart = performance.now();
    for (const r of changedResults) {
      writeFileSync(r.filePath, r.output, "utf8");
    }
    writeMs = performance.now() - writeStart;
  }

  const totalMs = performance.now() - t0;
  const parseMs = formatMetrics.brsMs + formatMetrics.xmlMs;
  const parseCount = formatMetrics.brsCount + formatMetrics.xmlCount;
  const bsfmtMs = formatMetrics.bsfmtMs;
  const rulesMs = formatMetrics.rulesMs;
  const applyMs = formatMetrics.applyMs;
  const otherMs = formatMs - parseMs - bsfmtMs - rulesMs - applyMs;

  // ---- Report ---------------------------------------------------------------
  const mode = args.corpus ? `external (${args.corpus})` : `synthetic seed=${args.seed}`;
  const lines = [
    "",
    "bsprettier benchmark",
    "====================",
    `corpus        ${mode}`,
    `files         ${filePaths.length}`,
    `bytes         ${(corpus.bytes / 1024 / 1024).toFixed(2)} MiB`,
    `changed       ${changed}`,
    `errored       ${errored}`,
    "",
    "phase breakdown",
    "---------------",
    `read/gen      ${fmtMs(readMs).padStart(10)}   ${pct(readMs, totalMs)}`,
    `migrate       ${fmtMs(migrateMs).padStart(10)}   ${pct(migrateMs, totalMs)}`,
    `context       ${fmtMs(ctxMs).padStart(10)}   ${pct(ctxMs, totalMs)}`,
    `format        ${fmtMs(formatMs).padStart(10)}   ${pct(formatMs, totalMs)}`,
    corpus.writable
      ? `write         ${fmtMs(writeMs).padStart(10)}   ${pct(writeMs, totalMs)}`
      : `write         (skipped: external corpus is read-only)`,
    `total         ${fmtMs(totalMs).padStart(10)}`,
    "",
    "format internals (slice of format phase)",
    "-----------------------------------------",
    `parse         ${fmtMs(parseMs).padStart(10)}   ${pct(parseMs, formatMs)}`,
    `bsfmt         ${fmtMs(bsfmtMs).padStart(10)}   ${pct(bsfmtMs, formatMs)}`,
    `rules         ${fmtMs(rulesMs).padStart(10)}   ${pct(rulesMs, formatMs)}`,
    `applyEdits    ${fmtMs(applyMs).padStart(10)}   ${pct(applyMs, formatMs)}`,
    // Slices are timed independently; the remainder (suppression maps, rule
    // selection, dispatch) plus ~1% clock/overhead noise. May go slightly
    // negative when measurement overhead exceeds the genuine remainder.
    `other         ${fmtMs(otherMs).padStart(10)}   ${pct(otherMs, formatMs)}`,
    "",
    "parsing detail",
    "--------------",
    `brs parses    ${String(formatMetrics.brsCount).padStart(7)}   ${fmtMs(formatMetrics.brsMs)}`,
    `xml parses    ${String(formatMetrics.xmlCount).padStart(7)}   ${fmtMs(formatMetrics.xmlMs)}`,
    `bsfmt calls   ${String(formatMetrics.bsfmtCount).padStart(7)}   ${fmtMs(bsfmtMs)}`,
    `total parses  ${String(parseCount).padStart(7)}   ${fmtMs(parseMs)}`,
    `parses / file             ${(parseCount / filePaths.length).toFixed(2)}`,
    "",
  ];

  if (args.perRule) {
    const rows = [...formatMetrics.ruleMs.entries()]
      .map(([id, ms]) => ({ id, ms, count: formatMetrics.ruleCount.get(id) ?? 0 }))
      .sort((a, b) => b.ms - a.ms);
    const sumRuleMs = rows.reduce((s, r) => s + r.ms, 0);
    const idWidth = Math.max(7, ...rows.map((r) => r.id.length));
    lines.push(
      "per-rule profile (sorted by total time)",
      "---------------------------------------",
      // rulesMs aggregate is inflated by per-rule timing overhead in this mode;
      // use the per-rule sum as the denominator for share-of-rules.
      `${"rule".padEnd(idWidth)}   ${"ms".padStart(9)}   ${"calls".padStart(7)}   ${"us/call".padStart(8)}   ${"%rules".padStart(7)}   ${"%fmt".padStart(6)}`,
      ...rows.map((r) => {
        const usPer = r.count > 0 ? (r.ms * 1000) / r.count : 0;
        return `${r.id.padEnd(idWidth)}   ${r.ms.toFixed(1).padStart(9)}   ${String(r.count).padStart(7)}   ${usPer.toFixed(1).padStart(8)}   ${pct(r.ms, sumRuleMs).padStart(7)}   ${pct(r.ms, formatMs).padStart(6)}`;
      }),
      `${"TOTAL".padEnd(idWidth)}   ${sumRuleMs.toFixed(1).padStart(9)}`,
      "",
    );
  }

  console.log(lines.join("\n"));
}

main();
