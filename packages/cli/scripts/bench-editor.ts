import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import fastGlob from "fast-glob";
import {
  WorkspaceFormatService,
  formatSingleFileForEditor,
} from "../src/index.js";

interface Sample {
  filePath: string;
  source: string;
}

interface Args {
  corpus?: string;
  iterations: number;
  samples: string[];
  gc: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { iterations: 25, samples: [], gc: false };
  for (const arg of argv) {
    if (arg.startsWith("--corpus=")) {
      args.corpus = arg.slice("--corpus=".length);
    } else if (arg.startsWith("--iterations=")) {
      args.iterations = Number(arg.slice("--iterations=".length)) || args.iterations;
    } else if (arg.startsWith("--sample=")) {
      args.samples.push(arg.slice("--sample=".length));
    } else if (arg === "--gc") {
      args.gc = true;
    }
  }
  return args;
}

function createSyntheticCorpus(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "bsprettier-editor-bench-"));
  const componentDir = join(root, "components", "player");
  mkdirSync(componentDir, { recursive: true });
  writeFileSync(
    join(componentDir, "LivePlayer.xml"),
    '<component name="LivePlayer" extends="Group">\n' +
      '  <script type="text/brightscript" uri="LivePlayer.brs" />\n' +
      '  <script type="text/brightscript" uri="LivePlayertracking.brs" />\n' +
      "  <interface>\n" +
      '    <function name="show" />\n' +
      "  </interface>\n" +
      "</component>\n",
    "utf8",
  );
  writeFileSync(
    join(componentDir, "LivePlayer.brs"),
    "sub show()\n" +
      "    if (m.ready) then trackPageLoad()\n" +
      "end sub\n",
    "utf8",
  );
  writeFileSync(
    join(componentDir, "LivePlayertracking.brs"),
    "sub trackPageLoad()\n" +
      "end sub\n",
    "utf8",
  );
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function expandXmlPair(filePath: string): string[] {
  if (!/\.xml$/i.test(filePath)) return [filePath];
  return [filePath, filePath.replace(/\.xml$/i, ".brs")];
}

function explicitSamples(root: string, paths: string[]): Sample[] {
  return paths
    .flatMap(expandXmlPair)
    .map((filePath) => (isAbsolute(filePath) ? filePath : resolve(root, filePath)))
    .map((filePath) => ({
      filePath,
      source: readFileSync(filePath, "utf8"),
    }));
}

function pickSamples(root: string, paths: string[]): Sample[] {
  if (paths.length > 0) return explicitSamples(root, paths);

  const candidates = [
    "components/player/LivePlayer.brs",
    "components/player/LivePlayertracking.brs",
    "components/player/LivePlayer.xml",
  ];
  const samples: Sample[] = [];
  for (const candidate of candidates) {
    const abs = resolve(root, candidate);
    try {
      samples.push({ filePath: abs, source: readFileSync(abs, "utf8") });
    } catch {
      // Real corpora won't have the synthetic paths. Fall through to glob-lite.
    }
  }
  if (samples.length > 0) return samples;

  return fastGlob
    .sync(["**/*.{brs,bs,xml}"], {
      cwd: root,
      absolute: true,
      ignore: ["**/node_modules/**", "**/roku_modules/**", "**/dist/**"],
      onlyFiles: true,
    })
    .slice(0, 12)
    .map((filePath) => ({
      filePath,
      source: readFileSync(filePath, "utf8"),
    }));
}

function time(
  label: string,
  fn: () => void,
  iterations: number,
  requestsPerIteration = 1,
): number {
  const started = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const ms = performance.now() - started;
  const requests = iterations * requestsPerIteration;
  const per = ms / requests;
  console.log(
    `${label}: ${per.toFixed(2)}ms/request (${requests} requests, ${iterations} iterations)`,
  );
  return per;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function memoryLabel(): string {
  const memory = process.memoryUsage();
  return `rss=${formatBytes(memory.rss)} heap=${formatBytes(memory.heapUsed)}`;
}

function forceGc(label: string, enabled: boolean): void {
  if (!enabled) return;
  if (typeof global.gc !== "function") {
    console.log(`${label}: GC unavailable (run node --expose-gc ...)`);
    return;
  }
  global.gc();
  console.log(`${label}: ${memoryLabel()}`);
}

function coldCli(sample: Sample): void {
  const cliPath = resolve("dist/node.js");
  const result = spawnSync(
    process.execPath,
    [cliPath, "--stdin-filepath", sample.filePath],
    {
      input: sample.source,
      encoding: "utf8",
    },
  );
  if (result.status !== 0 && result.status !== 2) {
    throw new Error(result.stderr || `cold CLI failed with ${result.status}`);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const synthetic = args.corpus ? null : createSyntheticCorpus();
  const root = args.corpus ? resolve(args.corpus) : synthetic!.root;
  const samples = pickSamples(root, args.samples);
  if (samples.length === 0) {
    throw new Error(`no .brs/.bs/.xml samples found under ${root}`);
  }

  console.log(`Corpus: ${root}`);
  console.log(`Samples: ${samples.map((s) => relative(root, s.filePath)).join(", ")}`);
  console.log(`Initial memory: ${memoryLabel()}`);
  forceGc("After initial GC", args.gc);

  try {
    const service = new WorkspaceFormatService({ cwd: root });
    const first = samples[0]!;
    service.format({ mode: "project", filePath: first.filePath, source: first.source });
    console.log(`After workspace warmup: ${memoryLabel()}`);
    forceGc("After workspace warmup GC", args.gc);

    time("warm single-file", () => {
      for (const sample of samples) {
        formatSingleFileForEditor({
          cwd: root,
          filePath: sample.filePath,
          source: sample.source,
        });
      }
    }, args.iterations, samples.length);

    time("warm project-aware", () => {
      for (const sample of samples) {
        service.format({
          mode: "project",
          filePath: sample.filePath,
          source: sample.source,
        });
      }
    }, args.iterations, samples.length);
    console.log(`After warm project formats: ${memoryLabel()}`);
    forceGc("After warm project formats GC", args.gc);

    try {
      time("cold CLI stdin", () => coldCli(first), Math.max(3, Math.min(8, args.iterations)));
    } catch (err) {
      console.log(
        `cold CLI stdin: skipped (${err instanceof Error ? err.message : String(err)})`,
      );
    }

    const single = formatSingleFileForEditor({
      cwd: root,
      filePath: first.filePath,
      source: first.source,
    });
    const project = service.format({
      mode: "project",
      filePath: first.filePath,
      source: first.source,
    });
    console.log(`Single-file changed: ${single.changed}`);
    console.log(`Project-aware changed: ${project.result.changed}`);
  } finally {
    synthetic?.cleanup();
  }
}

main();
