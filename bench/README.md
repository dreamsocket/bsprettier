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
- **parsing (within format phase)** — parser invocation counts and time, gated by
  an opt-in flag in `src/parser/metrics.ts` (zero cost when disabled). `parses /
  file` exposes the multi-phase reparse cost; `parse / format` bounds how much
  parse caching could ever save.

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

What's left in `format` is mostly the brighterscript-formatter final pass and
rule logic, plus the *necessary* reparses after genuine mutations. Going
further means incremental reparsing or rules emitting AST deltas — bigger
architectural changes with diminishing returns; re-measure here before attempting
them.
