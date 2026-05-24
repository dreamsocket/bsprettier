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
import { parseMetrics, resetParseMetrics } from "../src/parser/metrics.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const TEMPLATE_DIR = join(REPO_ROOT, "bench", "templates");

interface BenchArgs {
  files: number;
  seed: number;
  out: string;
  corpus?: string;
}

function parseArgs(argv: string[]): BenchArgs {
  const args: BenchArgs = {
    files: 1200,
    seed: 1,
    out: join(REPO_ROOT, ".bench-corpus"),
  };
  for (const arg of argv) {
    if (arg.startsWith("--files=")) args.files = Number(arg.slice(8));
    else if (arg.startsWith("--seed=")) args.seed = Number(arg.slice(7));
    else if (arg.startsWith("--out=")) args.out = resolve(arg.slice(6));
    else if (arg.startsWith("--corpus=")) args.corpus = resolve(arg.slice(9));
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
  resetParseMetrics();
  parseMetrics.enabled = true;
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
  parseMetrics.enabled = false;

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
  const parseMs = parseMetrics.brsMs + parseMetrics.xmlMs;
  const parseCount = parseMetrics.brsCount + parseMetrics.xmlCount;

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
    "parsing (within format phase)",
    "-----------------------------",
    `brs parses    ${String(parseMetrics.brsCount).padStart(7)}   ${fmtMs(parseMetrics.brsMs)}`,
    `xml parses    ${String(parseMetrics.xmlCount).padStart(7)}   ${fmtMs(parseMetrics.xmlMs)}`,
    `total parses  ${String(parseCount).padStart(7)}   ${fmtMs(parseMs)}`,
    `parse / format            ${pct(parseMs, formatMs)}`,
    `parses / file             ${(parseCount / filePaths.length).toFixed(2)}`,
    "",
  ];
  console.log(lines.join("\n"));
}

main();
