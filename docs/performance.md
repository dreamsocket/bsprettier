# Performance — how it was implemented

As-built record of the performance work in the CLI/formatter. This is
documentation of what shipped and how it is measured, not a backlog. All paths
are relative to `packages/cli/` unless noted.

## Two workloads (different bottlenecks — don't conflate)

1. **One-shot, whole project** (initial format pass, run rarely). Cold run; cost
   is the format phase. This is what `npm run bench` measures.
2. **Editor-on-save** (the ongoing dev workflow, run constantly). Formats one
   file. A *cold* CLI invocation here spent ~400ms loading BrighterScript's
   module graph and only ~5–10ms actually formatting — so format-phase
   optimizations do nothing for it. This bottleneck was addressed architecturally
   by keeping BrighterScript warm in the VS Code/Cursor extension host rather than
   by optimizing format code. See [`vscode-extension.md`](./vscode-extension.md).

## Invariants the work held to

- Output stays **byte-identical** to the previous serial output. Verified per
  change (method below), never assumed.
- `npm test` and `npm run typecheck` stay green.
- Wins are compared as *ratios* via an A/B `git stash`, not absolute ms.

## What shipped (~1.7x on the real corpus)

Cumulative, all byte-identical, on the real Roku app corpus: format
**5850ms → 3550ms**, total **6145ms → 3870ms**.

1. **AST walk rewrite** (`src/parser/brs-walk.ts`) — the big one (~1.5x). The
   generic BRS AST walk skips the token/position substructure
   (`location`/`range`/`tokens`/trivia) that dwarfed real nodes, and
   `findNodesOfKind` caches a per-AST kind index. This fixed the two `if`-rules
   that were ~40% of format (`brs/block-if-form` ~14x, `brs/if-condition-parens`
   ~60x).
2. **`linkedBrsForXml` per-dir cache** (`src/project/context.ts`, ~3%) — it had
   been re-iterating every project source and re-joining sibling scripts on every
   `<field>` classify call. Fixed `xml/interface-section-order`.
3. **Format instrumentation** (`src/parser/metrics.ts`) — `formatMetrics` plus
   `npm run bench -- --per-rule`. Profiling only, zero production cost when
   disabled.
4. **Warm editor service** — the editor-on-save startup cost (~400ms/save) is
   eliminated by formatting in a long-lived process. See `src/editor.ts`,
   `src/editor/workspace-service.ts`, and the extension doc.

Per-rule numbers live in `bench/README.md`.

## Current baseline

Real corpus (1240 files): format **3548ms / 91.8%** of total **3866ms**.
Format internals: **parse 42% / bsfmt 41% / rules 23% / applyEdits <1%**. Parse
and bsfmt are co-equal leaders (~42% each); rules dropped to ~23%.

Synthetic (`npm run bench`, 1200 files): format ~1700ms / total ~2090ms.

Warm editor service (`npm run bench:editor -- --iterations=3`, smoke numbers on
the synthetic editor corpus): warm single-file ~5.4ms/request, warm
project-aware ~4.4ms/request, cold CLI stdin ~492ms/request.

## How to measure

- `npm run bench` — synthetic corpus (deterministic, `--seed`, `--files=N`),
  regenerated unformatted each run, so it measures the real cold first run.
- `npm run bench -- --per-rule` — adds a per-rule breakdown (has timing
  overhead; use it to *rank* rules, read the clean run for slice totals).
- `npm run bench -- --corpus=../../nbc/roku-app` — read-only spot check against
  the real Roku app.
- `npm run bench:editor` — editor-on-save latency/memory (separate from
  `npm run bench`; do not conflate the two workloads).

Harnesses: `scripts/bench.ts`, `scripts/bench-editor.ts`. Running log:
`bench/README.md`.

**Byte-identical verification (run for every change):** a throwaway tsx script
loads the real corpus, runs `formatFile` over every file, and prints a sha256 of
all outputs. Run after, `git stash push <changed-file>`, run before, `git stash
pop`; the two shas must match. (Real corpus: `changed=152 errored=1`; the one
error is pre-existing.)

## Key files

- `src/edit/runner.ts` — `formatFile`/`formatBrs`/`formatXml`, the per-file unit
  of work. Pure given `(filePath, source, config, projectSources,
  projectContext)`.
- `src/project/context.ts` — `ProjectContext`, built once; cross-file lookups
  with per-pass caches (`brsParseCache`, `publicNamesCache`, `linkedBrsCache`).
- `src/parser/brs-walk.ts` — the cheap AST walk and `findNodesOfKind` kind index.
- `src/parser/metrics.ts` — `formatMetrics` profiling hooks.
- `src/cli.ts` — the CLI format loop.

## Measured and deliberately not pursued

Recorded so these aren't re-explored:

- **I/O concurrency** across files — measured, not worth it.
- **Worker-thread parallelism** — a spike proved byte-identical output, but the
  per-worker BrighterScript load (~16MB module graph) dominates; after the
  single-thread wins the case is weak (Amdahl). Not pursued.
- **bsfmt skip when no rule edits land** — unsafe; a file with no rule hits still
  needs bsfmt's indentation fixes, so skipping changes output.
- **Caching the computed rename map in `audit/private-member-naming`** — does
  nothing; the underlying sibling-script parse dominates. Reverted.

## Distribution note

Shipped via Git (`npm install dreamsocket/bsprettier#<tag>`), not the registry.
`dist/` is gitignored, built by `prepare` on install. No bundle for the core
CLI.
