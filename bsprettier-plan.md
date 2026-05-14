# bsprettier Implementation Plan (Comprehensive)

Date: 2026-05-14
Status: ready for review / agent handoff

This plan specifies a standalone TypeScript/Node CLI for formatting BrightScript
(`.brs`), BrighterScript (`.bs`), and SceneGraph XML (`.xml`) files according to
Dreamsocket conventions. The package is designed from the start as a public
GitHub repository and npm dependency.

- Proposed package name: `@dreamsocket/bsprettier`
- Proposed executable: `bsprettier`
- Primary file types: `.brs`, `.bs`, `.xml`

This revision verifies upstream facts, fills gaps in the original draft, and is
detailed enough to hand to an implementing agent.

---

## 1. Findings From Upstream Tools (verified 2026-05-14)

### BrighterScript / BSC

- npm `latest` = `0.72.1`; npm `next` = `1.0.0-alpha.50`. v1 is alpha.
- v1 introduced significant breaking changes; plugins are versioned and can
  detect host version via `pluginOptions?.version` (undefined ⇒ treat as v0).
- Plugin lifecycle hooks: `beforeProgramCreate` → `afterProgramCreate` →
  file parse/validate hooks → transpile hooks (`beforeFileTranspile` etc.),
  plus language-server hooks.
- The **`AstEditor`** (the only "safe" mutation API) is **only available during
  `beforeFileTranspile`**. Direct AST mutation outside transpile is explicitly
  discouraged. `XmlFile` has **no real AST** and can only be "patched."
- AST walking helpers: `createVisitor()`, `WalkMode`, and `ASTUtils`.

**Decision (unchanged, now better justified):** build a **CLI first**, not a BSC
plugin. The CLI uses BSC v1 **only as a lexer/parser library** to obtain tokens
and an AST; all mutation is done as **offset-based text splices on the original
source**, never via `AstEditor`. `AstEditor` is transpile-scoped and unsuitable
for a formatter that rewrites files on disk. A BSC plugin (Phase 6) can later
reuse the rule modules as **diagnostics only**.

### brighterscript-formatter (bsfmt)

- `brighterscript-formatter@1.7.25` depends on `brighterscript@^0.72.1` (v0).
- Handles: indentation (style/size/enable), keyword case + type case (with
  per-token overrides), composite keyword split/combine, trailing/interior
  whitespace, brace formatting, comment style normalization, multi-line
  object/array reflow, **import sorting**, function-declaration paren spacing.
- Library API: `formatter.format(text, options)` and `formatWithSourceMap(text)`.

**Decision (unchanged):** do not embed bsfmt as a runtime dependency in a
v1-based tool. Document it as an **optional external pre-pass**. bsprettier owns
the *final* Dreamsocket style and must run **last**.

### bslint

- `@rokucommunity/bslint@0.8.43` peer-deps `brighterscript >= 0.59.0 < 1` (v0).
- Relevant default rules (verified):
  - `inline-if-style`: `never | no-then | then(default) | off`
  - `block-if-style`: `no-then(default) | then | off`
  - `condition-style`: `no-group(default) | group | off` — **bslint can already
    enforce/strip parentheses around `if`/`while` conditions, and `--fix` repairs
    it.**
  - `named-function-style` / `anon-function-style`: `auto` default
  - `aa-comma-style`: `no-dangling` default
  - `eol-last`: `always` default (final newline)
  - `case-sensitivity`, `consistent-return`, code-flow rules, etc.
- `bslint --fix` repairs basic code-style issues (optional `then`, condition
  parens, AA commas, case sensitivity, final newline).

**Important consequence — overlap is real.** The original plan claimed bslint
"does not model" condition parens; it does (`condition-style: group`). The
genuine Dreamsocket-specific delta is **spacing**: Dreamsocket wants
`if(condition)` / `else if(condition)` with **no space** between keyword and `(`,
which neither bslint nor bsfmt produce (bsfmt's keyword handling tends to insert
a space). So bsprettier's value is the *exact spelling*, not the *concept*.

### Tool overlap matrix (drives "who owns what")

| Concern | bsfmt | bslint | bsprettier owns? |
|---|---|---|---|
| Indentation, keyword case, trailing ws | yes | no | no (defer to bsfmt) |
| Import sorting (`.bs`) | yes | no | no (defer to bsfmt) |
| Condition parentheses (presence) | no | yes (`group`) | no, but depends on it |
| Condition paren **spacing** `if(` | no | no | **yes** |
| Inline-if `then` presence | no | yes | no |
| Inline-if → block conversion | no | no | **yes** |
| Final newline | no | yes (`eol-last`) | **yes** (own it; cheap, idempotent) |
| Top-level routine cohort order | no | no | **yes** |
| Blank-line count between routines | no | no | **yes** |
| XML script/interface/attribute order | no | no | **yes** |
| `onChange` field avoidance | no | no | **yes** (diagnostic v1) |

Recommended full project pipeline (when project can still run v0 tools):

```sh
bsfmt   "components/**/*.{brs,bs}"      --write
bslint  --fix
bsprettier "components/**/*.{brs,bs,xml}" --write
```

For bsprettier's own implementation, the only required formatter dependency is
BrighterScript v1 plus an XML CST parser.

---

## 2. Product Scope

`bsprettier` is an opinionated formatter and convention auditor. It must be
deterministic, idempotent, and safe to run on save or after AI-generated edits.

### In scope for v1

- Lex/parse `.brs` and `.bs` with BrighterScript v1 (library mode).
- Parse `.xml` with a CST-style parser preserving offsets and trivia.
- Apply safe, offset-based text edits; abort on conflict or parse error.
- BRS/BS: top-level declaration order, blank-line spacing, `if(` spelling,
  inline-`if` → block conversion.
- XML: script order, interface section order, attribute order; `onChange`
  diagnostic.
- `--write`, `--check`, `--list-different`, stdin/stdout mode.
- Golden-file + idempotency + roundtrip-parse tests.

### Out of scope for v1

- Reordering or rewriting statements *inside* routines (beyond the two
  if-conventions).
- Semantic refactors, cross-file renames.
- Cross-component alias/event classification (v2).
- BSC language-server plugin (Phase 6, diagnostics only).
- Replacing bsfmt/bslint; indentation and keyword-case normalization.

---

## 3. Architecture

### 3.1 CLI first

```sh
bsprettier <glob...> --check
bsprettier <glob...> --write
bsprettier --stdin-filepath components/foo/Bar.brs < Bar.brs
```

The CLI is the stable public interface for CI, pre-commit hooks, editor
format-on-save, and AI-agent post-processing.

### 3.2 Parser layer

Two adapters, each isolating its upstream dependency behind a narrow interface:

- `src/parser/brighterscript-adapter.ts`: wraps BSC v1 for `.brs`/`.bs`.
- `src/parser/xml.ts`: wraps `@xml-tools/parser` (CST) for `.xml`.

**BSC v1 library usage (gap filled).** For a formatter we do **not** need a full
`Program`/scope/validation pass. Use the lexer + parser only:

- `Lexer.scan(source)` → token stream (each token has a `range`).
- `Parser.parse(tokens, options)` → AST + the token list + parser diagnostics.
- Treat any *fatal* parse diagnostic as "do not edit this file" (exit code 2 for
  that file). Non-fatal/semantic diagnostics are ignored — we are not a compiler.
- Pin the exact alpha; the adapter is the single import site so a bump touches
  one file.

**Offset mapping (gap filled).** BSC ranges are LSP-style `{line, character}`
(0-based line, UTF-16 char offset), **not** absolute byte/char offsets, while the
Edit model uses absolute offsets. The adapter must build a **line-index** from
the raw source (array of line-start offsets) and expose:

```ts
positionToOffset(pos: { line: number; character: number }): number
offsetToPosition(offset: number): { line: number; character: number }
rangeToSpan(range): { offset: number; length: number }
```

All offsets and spans are **UTF-16 code-unit indices** into the JavaScript
source string (matching LSP `character` semantics and JS `string` indexing) —
never byte offsets. All rules consume spans, never raw BSC ranges. Add line-index
unit tests for CRLF, tabs, non-ASCII BMP characters, and **surrogate-pair
characters** (e.g. emoji in string literals/comments) to catch byte/code-unit
mixups.

**Trivia / comments (gap filled).** Comment handling differs between BSC v0 and
v1; the adapter must expose, for each top-level statement, its **leading trivia
span** (comments + whitespace immediately preceding it) and **trailing
same-line comment**, computed from token offsets if v1 does not attach trivia
directly. This is required for `brs/declaration-order` (banners must travel with
their routine) and `brs/declaration-spacing`.

### 3.3 XML CST layer

Use `@xml-tools/parser` (`1.0.11`). Do **not** serialize whole documents through
a DOM. XML rules splice the original source so comments, banners, and whitespace
outside edited regions survive byte-for-byte. The adapter exposes element/
attribute nodes with absolute source offsets.

### 3.4 Edit model

```ts
interface Edit {
  ruleId: string;
  offset: number;   // absolute UTF-16 code-unit index into the source string
  length: number;   // length in UTF-16 code units
  replacement: string;
}

interface Diagnostic {
  ruleId: string;
  severity: "error" | "warn" | "info";
  message: string;
  span?: { offset: number; length: number };
  fixable: boolean;
}

interface RuleResult { edits: Edit[]; diagnostics: Diagnostic[]; }
```

### 3.5 Runner: composition vs. conflict (gap filled)

The original draft said "abort on overlapping edits," but two rules legitimately
touch the same region — e.g. `declaration-order` and `declaration-spacing` both
operate on inter-routine gaps. The runner therefore distinguishes:

1. **Rule phases run in a fixed pipeline**, each phase re-parsing the (in-memory)
   result of the previous phase:
   - Phase A — structural moves: `brs/declaration-order`
   - Phase B — spacing: `brs/declaration-spacing`
   - Phase C — inline-if conversion: `brs/block-if-form`
   - Phase D — condition spelling: `brs/if-condition-parens`
   - XML phases: attribute-order → script-order → interface-section-order
   Re-parsing between phases means later phases never see stale offsets, and
   sequential phases compose naturally instead of conflicting. In particular
   `block-if-form` (Phase C) replaces the whole inline-`if` span; the re-parse
   afterward turns it into an ordinary block-`if`, which `if-condition-parens`
   (Phase D) then normalizes uniformly alongside block-`if`s already in source.
   This is why the two if-rules are **separate sequential phases**, not one —
   they would otherwise emit overlapping edits on the same inline-`if` span.
2. **Within a single phase**, edits from different rules must not overlap. If
   they do, it is a real bug → abort the file with exit code 2 and report which
   rules collided.
3. Edits within a phase are applied **highest-offset → lowest-offset**.
4. After the final phase, **re-parse the output**; if it no longer parses, the
   write is rejected and the original file is left untouched.
5. **Idempotency is asserted in tests**, not at runtime: `format(format(x)) ===
   format(x)`.

### 3.6 Line endings, encoding, indentation (gap filled)

- Detect dominant EOL (`\n` vs `\r\n`) per file; preserve it in all generated
  text (blank lines, inserted `end if`). Normalize mixed EOLs only if a future
  `eol` rule is enabled — off by default.
- Preserve a leading BOM if present; assume UTF-8 otherwise.
- bsprettier does **not** own indentation, but `brs/block-if-form` *creates*
  lines and must indent them. It detects the enclosing statement's indentation
  (whitespace before the `if` token) and the file's indent unit (first indented
  line: tabs vs N spaces) and reuses it. If indentation cannot be confidently
  determined, the rule emits a diagnostic instead of editing.

---

## 4. Repository Layout

```text
bsprettier/
├── bin/bsprettier.js
├── src/
│   ├── cli.ts
│   ├── index.ts                 # programmatic API: formatText/formatFile
│   ├── config.ts
│   ├── parser/
│   │   ├── brighterscript-adapter.ts
│   │   ├── brs.ts
│   │   └── xml.ts
│   ├── edit/
│   │   ├── apply.ts
│   │   ├── runner.ts
│   │   └── types.ts
│   ├── rules/
│   │   ├── registry.ts
│   │   ├── brs/{declaration-order,declaration-spacing,if-condition-parens,block-if-form}.ts
│   │   ├── xml/{attribute-order,script-order,interface-section-order,no-onchange-field}.ts
│   │   └── audit/{handler-intent,hardcoded-string,private-member-naming,ui-node-prefix,prefer-dreamsocket-utils}.ts
│   ├── classify/{brs-cohort,xml-interface-field}.ts
│   └── util/{ascii-sort,offsets,line-index,paths,eol}.ts
├── test/{fixtures,golden,unit,corpus}/
├── bsprettier.schema.json
├── README.md  CHANGELOG.md  LICENSE  package.json  tsconfig.json
```

---

## 5. Dependencies

Runtime:

- `brighterscript@1.0.0-alpha.50` (pinned exactly).
- `@xml-tools/parser@1.0.11` (XML CST).
- `fast-glob` (file discovery).
- `ignore` (`.gitignore` support).
- `cosmiconfig` (config discovery) — or a small custom JSON loader.
- `picocolors` (CLI output).

Dev: `typescript`, `vitest`, `tsx`, `eslint`, `prettier` (for this TS repo only).

Do **not** add `brighterscript-formatter` or `@rokucommunity/bslint` as runtime
deps in v1 (v0-only peer constraints).

---

## 6. CLI Contract

```sh
bsprettier "components/**/*.{brs,bs,xml}" --check
bsprettier "components/**/*.{brs,bs,xml}" --write
bsprettier "components/**/*.{brs,bs,xml}" --write --verbose
bsprettier "components/**/*.xml" --rules=xml/script-order,xml/attribute-order --write
bsprettier --stdin-filepath components/example/Foo.brs < Foo.brs
```

- `--check`: exit non-zero if any file would change; print the list of files.
- `--list-different`: like `--check` but prints only paths (Prettier parity).
- `--write`: rewrite files in place.
- `--check` / `--write` / `--list-different` are mutually exclusive.
- `--rules=`: comma list to restrict the active rule set (still phase-ordered).
- `--config <path>`: explicit config file; otherwise cosmiconfig discovery.
- Stdin mode: reads stdin, writes formatted text to stdout; `--stdin-filepath`
  supplies the extension (file-type) and the cwd for config discovery.
- Default ignores: `**/roku_modules/**`, `**/node_modules/**`, `**/dist/**`,
  `**/build/**`, `**/out/**`, plus `.gitignore`.
- **`--check` output format (gap filled):** one line per differing file,
  `path` only by default; with `--verbose`, a per-rule summary
  (`path: brs/declaration-order, brs/declaration-spacing`). No full diff in v1.

Exit codes:

- `0` — clean, or `--write` succeeded.
- `1` — `--check` failed: formatting changes are needed.
- `2` — parse error, intra-phase edit conflict, or unsafe-rule abort (per file;
  the run aggregates and exits 2 if any file hit this).
- `3` — CLI usage error (bad flags, mutually-exclusive options, no inputs).

---

## 7. Configuration

Discovery via cosmiconfig: `bsprettier.config.json`, `.bsprettierrc.json`,
`.bsprettierrc`, or a `bsprettier` key in `package.json`.

```json
{
  "include": ["components/**/*.{brs,bs,xml}", "source/**/*.{brs,bs}"],
  "ignore": ["**/roku_modules/**", "**/node_modules/**", "**/dist/**"],
  "rules": {
    "brs/declaration-order": "error",
    "brs/declaration-spacing": "error",
    "brs/if-condition-parens": "error",
    "brs/block-if-form": "error",
    "xml/script-order": "error",
    "xml/interface-section-order": "error",
    "xml/attribute-order": "error",
    "xml/no-onchange-field": "warn",
    "audit/handler-intent": "warn",
    "audit/ui-node-prefix": "warn",
    "audit/private-member-naming": "warn",
    "audit/prefer-dreamsocket-utils": "off",
    "audit/hardcoded-string": "off"
  },
  "brs": {
    "blankLinesBetweenRoutines": 3
  },
  "xml": {
    "interfaceSectionComments": "preserve",
    "fieldClassificationOverrides": {}
  }
}
```

Severity behavior:

- `error` — `--check` fails; `--write` applies the fix if fixable.
- `warn` — `--check` reports a warning (does **not** fail check by default);
  `--write` applies the fix only if safe and fixable.
- `info` — diagnostic only.
- `off` — disabled.

**Inline suppression (gap filled).** Support file/line opt-out comments so the
tool is safe to adopt incrementally:

- `' bsprettier-disable` (whole file, must be first non-blank line)
- `' bsprettier-disable-next-line [ruleId,...]`
- XML: `<!-- bsprettier-disable -->` / `<!-- bsprettier-disable-next-line -->`

A suppressed rule emits neither an edit nor a check failure for that span.

---

## 8. Rule Plan

### 8.1 BRS/BS rules

#### `brs/declaration-order` — fixable

Reorders **only whole top-level `sub`/`function` declarations**. Never reorders
statements inside a routine.

Required cohort order:

1. `init`
2. Public routines
3. Private routines
4. Observer routines

Classification (`classify/brs-cohort.ts`):

- `init` — the routine literally named `init` (case-insensitive). If multiple,
  diagnostic + skip the rule for that file.
- Public — name does not start with `_`, excluding `init` and `onKeyEvent`.
- Private — name begins with `_`, except `_on*` handlers. `_set*` stays Private.
- Observer — `_on*` handlers and `onKeyEvent` (`onKeyEvent` sorts as the virtual
  name `_onKeyEvent`).
- Within Public/Private/Observer cohorts, sort ASCII-ascending by name. `init`
  is fixed first and never sorted.

**Trivia ownership rule (gap filled).** Each routine moves together with:
- its **leading trivia** = contiguous comment lines immediately above it with no
  blank line separating them from the `sub`/`function` keyword (banner comments);
- a blank-line gap between a comment block and the routine below means the
  comment belongs to the routine *above* (or is a file-section header) and does
  **not** move — it is treated as standalone trivia and left in place, with a
  diagnostic if that produces an awkward result.
- trailing same-line comment on the `end sub`/`end function` line moves with it.

**Hard scope limit for `.bs` (gap filled).** `.bs` files may contain
`namespace`, `class`, `interface`, `enum`, `const`, `import`, and annotation
(`@`) declarations. v1 behavior:
- The rule **only reorders top-level `sub`/`function`** declarations that are
  **not** inside a `namespace`/`class`.
- If a file contains `namespace`/`class` blocks, routines inside them are left
  untouched; only file-level free functions are ordered.
- `import` statements are left to bsfmt's import sorting — bsprettier does not
  touch them.
- If ordering free functions would interleave them with `namespace`/`class`
  blocks in a way that changes relative position of non-routine declarations,
  emit a diagnostic and skip rather than guess.

#### `brs/declaration-spacing` — fixable

Enforces exactly `blankLinesBetweenRoutines` (default 3) blank lines between
consecutive top-level routines — including between `init` and the first
post-init routine and across cohort boundaries. Collapses or expands the gap;
preserves banner comments (which belong to the following routine per the trivia
rule). File ends with exactly one trailing newline (EOL-correct).

Runs in Phase B, after `declaration-order`, on the re-parsed result.

#### `brs/if-condition-parens` — fixable where safe

Runs in **Phase D**, last among the BRS rules, so it normalizes both block-`if`s
already in source and block-`if`s just produced by `block-if-form` (Phase C) —
uniformly, on the re-parsed tree.

Enforces the exact spelling `if(condition)` and `else if(condition)` — no space
between keyword and `(`. Token-based, never regex:

- Requires the condition to already be parenthesized (a single paren group
  spanning the whole condition). If the condition is **not** parenthesized,
  bsprettier does **not** add parens in v1 (that is bslint `condition-style:
  group`'s job) — it emits an `info` diagnostic suggesting the pipeline.
- When parenthesized, the only edit is removing whitespace between the
  `if`/`else if` keyword token and the `(` token.
- Skip on parse ambiguity or when a comment sits between keyword and `(`.

#### `brs/block-if-form` — fixable where safe

Runs in **Phase C**. Converts single-line `if <cond> then <statement>` into
block form:

```brightscript
if <cond>
    statement
end if
```

- Replaces the **entire inline-`if` span** with the block form. This is why it
  is its own phase: its edit span overlaps the keyword/paren region that
  `if-condition-parens` edits, so the two rules must never share a phase.
- **Does not touch parentheses.** It preserves the condition's existing paren
  state byte-for-byte — if the source condition is unparenthesized it stays
  unparenthesized; if parenthesized, the parens are carried over verbatim.
  Condition-spelling normalization (`if(condition)` spacing) is left entirely to
  `if-condition-parens` in Phase D, which sees the converted block after the
  inter-phase re-parse.
- Only when there is exactly **one** consequent statement and **no** `else`.
- Indentation of the inserted `statement` and `end if` is derived per §3.6.
- Skip (diagnostic, no edit) when: multiple statements, an `else`/`else if`
  branch present, an inline comment that cannot be safely relocated, or any
  parse ambiguity.

### 8.2 XML rules

#### `xml/attribute-order` — fixable

- `<field>`: `id` first, then remaining attributes ASCII-ascending.
- `<function>`: `name` first, then remaining ASCII-ascending.
- SceneGraph nodes under `<children>` and nested descendants (`<Label>`,
  `<Poster>`, `<Font>`, custom components): `id` first when present, otherwise
  all attributes ASCII-ascending.
- Preserves the original quote style and inter-attribute newlines/indentation
  pattern (multi-line attribute blocks stay multi-line).

#### `xml/script-order` — fixable

- **Local-script identification (gap filled):** the component's own script is
  the `<script>` whose `uri` basename (minus extension) equals the component's
  `name` attribute on `<component>`, or whose `uri` resolves to a file sitting
  next to the `.xml` file. That script sorts first. If **more than one**
  `<script>` matches the "local" criteria (e.g. helper scripts kept beside the
  XML), treat it as ambiguous: preserve the existing relative order of the
  matches and emit a diagnostic rather than picking one arbitrarily.
- Remaining `pkg:`/`pkg_path` scripts sort ASCII-ascending by full `uri`.
- Scripts with unrecognized URI schemes are preserved in place and diagnosed if
  their position is ambiguous.

#### `xml/interface-section-order` — fixable, gated by classification confidence

Inside `<interface>`:

1. Events
2. Properties
3. Functions

Within each section: `<field>` rows sort by `id`, `<function>` rows sort by
`name`. Exactly one blank line between non-empty sections; no blank lines
between siblings in a section. Existing section comments are preserved
(`interfaceSectionComments: "preserve"`); v1 never inserts comments.

Field classification (`classify/xml-interface-field.ts`) — see §9. If any field
in the interface is **ambiguous and unresolved by config override**, the rule
**does not reorder that interface** and emits a `warn` diagnostic listing the
ambiguous fields. Partial reordering is not allowed (it would be misleading).

#### `xml/no-onchange-field` — diagnostic in v1

Flags `onChange="..."` on `<field>` and recommends `observeFieldScoped` in
`init()`. Autofix deferred until the tool can reliably locate/create `init()`
and avoid duplicate observers.

### 8.3 Audit rules — diagnostics first

- `audit/handler-intent` — `_set*` for property setters, `_on*` for event/result
  reactions.
- `audit/ui-node-prefix` — UI node references use `m._ui*`.
- `audit/private-member-naming` — private `m` members/params follow conventions.
- `audit/hardcoded-string` — user-facing strings should use
  `ResourceUtil_getString(...)`.
- `audit/prefer-dreamsocket-utils` — prefer `StringUtil_*`, `TypeUtil_*`,
  `ArrayUtil_*`, `ResourceUtil_*` helpers.

These never auto-fix in v1 unless a fix is unambiguous.

---

## 9. XML Field Classification Strategy

The riskiest area. Phased.

### v1 — single-component heuristics

Inputs: the component `.xml` and its local `.brs`.

Signals:

- `m.top.<fieldId> = ...` in non-`init` handlers → leans **Event** (outbound).
- `m.top.observeFieldScoped("<fieldId>", "_set...")` → leans **Property**.
- Reads of `m.top.<fieldId>` → lean **Property**.
- `alias=` to a known notify-style child field → leans **Event**.
- `alwaysNotify="true"` is a weak signal, never decisive alone.

Resolution:

- Explicit config override wins.
- Otherwise classify **Event** only when outbound writes are unambiguous.
- Conflicting signals with no override → **ambiguous**: do not reorder the
  interface (§8.2), emit a `warn` explaining the conflict.

Override shape:

```json
{
  "xml": {
    "fieldClassificationOverrides": {
      "components/nbc/app/content/Foo.xml": {
        "dismissClicked": "event",
        "data": "property"
      }
    }
  }
}
```

### v2 — component registry

Scan all component XML, resolve aliases to child components, inherit
Event/Property classification through aliases, cache per run. Not a v1 blocker.

---

## 10. Implementation Phases

### Phase 0 — Repository scaffold

- `package.json`, `tsconfig.json`, vitest setup, `.gitignore`, README, LICENSE,
  CHANGELOG, `bin/bsprettier.js`.
- Pin `brighterscript@1.0.0-alpha.50`; add XML parser + CLI deps.
- CI on Node 20 and 22 (Node 18 only if dependency compatibility is clean — see
  open question 5).

### Phase 1 — Parser + edit engine

- BSC v1 adapter: lexer/parser wrapper, line-index, offset mapping, trivia
  extraction, fatal-diagnostic detection.
- XML CST adapter with absolute offsets.
- Runner: phase pipeline, intra-phase conflict detection, reverse-offset apply,
  re-parse-after.
- EOL/BOM/indent utilities.
- Tests: parse→edit→reparse, line-index (CRLF/tabs/multibyte), idempotency
  harness.

### Phase 2 — BRS/BS rules

The **runtime phase order is fixed by §3.5** and is the single source of truth:
`declaration-order` (A) → `declaration-spacing` (B) → `block-if-form` (C) →
`if-condition-parens` (D).

Build the rules in that same order so each is validated on the re-parsed output
of the previous one: declaration-order and declaration-spacing are exercised on
whole-routine fixtures before the statement-level if-rules land.

### Phase 3 — XML rules

Order: `attribute-order` → `script-order` → `interface-section-order` →
`no-onchange-field`.

### Phase 4 — Audit diagnostics

Implement the five audit rules as non-fixing diagnostics.

### Phase 5 — Public-ready polish

- README with full rule catalog + pipeline guidance.
- Format-on-save and AI-agent recipes.
- `bsprettier.schema.json` for config validation.
- Release workflow, npm metadata, final package scope decision.

### Phase 6 — Optional BSC plugin

Separate entry point `@dreamsocket/bsprettier/bsc-plugin` (or a sibling
package). **Diagnostics + code actions only** — no broad file rewrites inside
the language server. Reuses the rule modules' diagnostic output, not their
edits.

---

## 11. Testing Strategy

### Golden fixtures

```text
test/fixtures/brs-declaration-order/basic/input.brs
test/fixtures/brs-declaration-order/basic/expected.brs
```

Every fixture asserts both:

- `format(input) === expected`
- `format(expected) === expected` (idempotency)

### Roundtrip parsing

`.brs`/`.bs`: parse with BSC v1 before and after; output must still parse.
`.xml`: parse with `@xml-tools/parser` before and after.

### EOL / encoding matrix

Run a representative fixture under `\n` and `\r\n`, with and without BOM, with
tab and space indentation — output must match the input's conventions.

### Safety fixtures (must refuse to edit)

- Parse errors → file untouched, exit 2.
- Intra-phase edit conflict → file untouched, exit 2.
- Ambiguous single-line `if` → diagnostic, no edit.
- Interface with conflicting Event/Property signals, no override → interface not
  reordered, `warn`.
- `.bs` file with `namespace`/`class` interleaving → free functions only or
  skip+diagnostic.

### Real project corpus

`test/corpus/` — anonymized Dreamsocket components added once available:
representative component XML, local BRS, shared scripts, alias/observer edge
cases. Run as a non-failing "diff report" job initially, promoted to assertions
once stable.

---

## 12. Format-on-Save and AI-Agent Use

Per-file via stdin:

```sh
bsprettier --stdin-filepath components/foo/Bar.brs < Bar.brs
```

Per-tree for agents:

```sh
bsprettier "components/foo/**/*.{brs,bs,xml}" --write
```

No watch mode in v1 — editors, task runners, and agent workflows invoke the CLI.

---

## 13. Key Risks

| Risk | Mitigation |
|---|---|
| BSC v1 API instability (alpha) | Exact pin; single adapter import site; golden fixtures gate every bump. |
| BSC range→offset mapping bugs | Dedicated line-index with CRLF/tab/multibyte unit tests. |
| Comment/trivia loss when moving routines | Explicit trivia-ownership rule (§8.1); roundtrip-parse + golden tests. |
| `.bs` constructs (namespace/class) mis-ordered | v1 only orders file-level free functions; skip+diagnostic on interleave. |
| XML roundtrip fidelity | No DOM serialization; offset splices only; comment/banner fixtures. |
| Event/Property misclassification | Conservative single-file heuristics; refuse-to-reorder on ambiguity; overrides; v2 registry deferred. |
| Unsafe inline-`if` rewrite | Token/AST based; skip multi-statement/`else`/comment/ambiguous cases. |
| Tool ping-pong with bsfmt/bslint | Documented pipeline order (bsprettier last); idempotency tests; overlap matrix §1. |
| Indentation guess wrong in `block-if-form` | Derive from enclosing line + file indent unit; diagnostic instead of edit if unsure. |

---

## 14. Acceptance Criteria

- `--check`, `--write`, `--list-different`, and stdin mode work on `.brs`,
  `.bs`, `.xml`.
- Every v1 formatting rule has golden fixtures with input + expected +
  idempotency assertions.
- Running the formatter twice produces no second diff (idempotency).
- Parse errors and intra-phase edit conflicts prevent writes (exit 2, file
  untouched).
- EOL/BOM/indentation conventions of each input are preserved.
- Inline `bsprettier-disable` suppression works for BRS and XML.
- README documents the bsfmt/bslint relationship and the overlap matrix.
- Package builds and can be published to npm.

---

## 15. Open Questions To Settle Before / During Implementation

1. Package scope: `@dreamsocket/bsprettier` vs unscoped `bsprettier` for broader
   Roku-community adoption?
2. Should bsprettier ever **insert** XML interface section comments, or stay
   preserve-only? (Plan assumes preserve-only for v1.)
3. `xml/no-onchange-field`: diagnostic-only in v1 (current plan), or invest early
   in a combined XML + `init()` autofix?
4. bsfmt/bslint integration: documented recipe only, or a future
   `bsprettier pipeline --write` wrapper command?
5. Minimum supported Node version for public release (CI proposes 20 + 22).
6. Should `brs/if-condition-parens` eventually also **add** missing parens
   (overlapping bslint `condition-style: group`), or stay spacing-only to keep a
   clean separation of concerns?
7. Does `--check` need a real unified diff in a later version, or is the
   file/rule list sufficient long-term?

---

## 16. Sources Reviewed

- BrighterScript plugin docs — https://github.com/rokucommunity/brighterscript/blob/master/docs/plugins.md
- brighterscript-formatter README — https://github.com/rokucommunity/brighterscript-formatter
- bslint README — https://github.com/rokucommunity/bslint
- npm metadata verified 2026-05-14:
  - `brighterscript`: latest `0.72.1`, next `1.0.0-alpha.50`
  - `brighterscript-formatter@1.7.25` → `brighterscript@^0.72.1`
  - `@rokucommunity/bslint@0.8.43` → peer `brighterscript >= 0.59.0 < 1`
  - `@xml-tools/parser@1.0.11`
