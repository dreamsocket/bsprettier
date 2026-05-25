# bsprettier benchmark

A self-contained, reproducible performance harness. It mirrors the CLI pipeline
(read → onChange migration → project context → format → write) over a corpus and
reports a phase breakdown plus parser call counts, so optimization work can be
driven by data.

## Run it

```sh
npm run bench                    # synthetic corpus, ~1200 files (default)
npm run bench -- --files=4000    # larger synthetic corpus
npm run bench -- --seed=7        # different deterministic corpus
```

## Corpus

The committed corpus is **synthetic**. `scripts/bench.ts` stamps the templates in
`bench/templates/` into a gitignored scratch dir (`.bench-corpus/`), varying the
component name per generated unit. A unit is one component XML plus its linked
`handlers.brs`, `util.brs`, and `model.bs`, so cross-file project context is
exercised. The generator is seeded (`--seed`, default `1`), so a given seed
reproduces the same corpus.

No external project code is committed or required.

### Local real-world spot check (not committed)

```sh
npm run bench -- --corpus=../path/to/roku-app
```

Points at a real project on your machine. It is **read-only** (the write phase is
skipped) and the path is never committed. Use this to confirm the synthetic
numbers track reality.

## What the numbers mean

- **phase breakdown** — wall-clock per phase. Tells you whether serial I/O is
  worth parallelizing (read/write) vs. whether the cost is in `format`.
- **format internals** — the format phase split into its slices (parse, bsfmt,
  rules, applyEdits, and the unattributed remainder), gated by an opt-in flag in
  `src/parser/metrics.ts` (zero cost when disabled). This is where optimization
  effort should be aimed. Slices are timed independently, so they need not sum
  exactly to the format phase (~1% clock/overhead noise; `other` may go slightly
  negative).
- **parsing detail** — parser/bsfmt invocation counts. `parses / file` exposes
  the multi-phase reparse cost.

## Baseline (seed=1, 1200 files, on the author's machine)

Indicative only — absolute numbers vary by machine. The **ratios** are the point.

| metric          | before parse-reuse | after parse-reuse | after phase cleanup |
| --------------- | ------------------ | ----------------- | ------------------- |
| format share    | ~92% of total      | ~88% of total     | ~85% of total       |
| parse / format  | ~37%               | ~33%              | ~30%                |
| total parses    | 9900               | 6300              | 5700                |
| parses / file   | ~8.3               | ~5.3              | 4.75                |

`formatBrs`/`formatXml` keep a single parse in sync with the working text and
reparse only after a real mutation, so unchanged phases and the old duplicate
"initial" parse are eliminated. BRS formatting now runs once at the end of the
pipeline, and declaration reordering applies the configured routine spacing in
the same edit. Together these cuts reduce total parses ~42% from the original
baseline.

### Format-internals breakdown (measured, not estimated)

Phase A1 instrumented the format phase precisely. The result **overturned the
earlier estimate** (which guessed bsfmt was the biggest slice at ~35%): rules
were actually ~50% of format, with parse ~30% and bsfmt ~20%. Per-rule profiling
(`npm run bench -- --per-rule`) then showed two `if`-handling rules dominated —
`brs/block-if-form` and `brs/if-condition-parens` — together ~40% of the whole
format phase, each spending most of its time in a full AST walk.

**Phase A2 fix — single cheap AST walk (`src/parser/brs-walk.ts`):** the walk now
skips the token/position substructure (`location`/`range`/`tokens`/trivia) that
dwarfed the real statement nodes, and `findNodesOfKind` caches a per-AST
kind index so repeat queries reuse one walk. Output is byte-identical (verified
across the full real corpus). Effect:

| rule                      | before (us/call) | after (us/call) | speedup |
| ------------------------- | ---------------- | --------------- | ------- |
| `brs/block-if-form`       | ~1900            | ~140            | ~14x    |
| `brs/if-condition-parens` | ~1700            | ~30             | ~60x    |

End-to-end (real corpus, 1240 files): format 5850ms → 3630ms, total 6145ms →
3955ms — **~1.5x**. Post-fix the format phase splits roughly parse ~39% /
bsfmt ~39% / rules ~26% / applyEdits <1%; parse and bsfmt are now co-equal
leaders. `applyEdits` was always noise. Next levers: bsfmt (skip/cache) and the
remaining rule walkers (`xml/interface-section-order`, `audit/private-member-naming`
no longer use the shared walk and are now the top rules). Going further on parse
means incremental reparse or AST-delta rules — bigger changes, diminishing
returns.
