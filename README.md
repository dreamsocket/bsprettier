# bsprettier

An opinionated formatter and convention auditor for **BrightScript** (`.brs`),
**BrighterScript** (`.bs`), and **SceneGraph XML** (`.xml`) files, built to
Dreamsocket conventions.

bsprettier is deterministic, idempotent, and safe to run on save or after
AI-generated edits. It uses BrighterScript v1 purely as a lexer/parser library
and applies **offset-based text splices** to the original source — it never
serializes through a DOM and never rewrites a file it cannot re-parse.

## Install

```sh
npm install --save-dev @dreamsocket/bsprettier
```

## Usage

```sh
bsprettier "components/**/*.{brs,bs,xml}" --check
bsprettier "components/**/*.{brs,bs,xml}" --write
bsprettier "components/**/*.{brs,bs,xml}" --write --progress
bsprettier "components/**/*.{brs,bs,xml}" --write --verbose
bsprettier "components/**/*.xml" --rules=xml/script-order,xml/attribute-order --write
bsprettier --stdin-filepath components/example/Foo.brs < Foo.brs
```

| Flag | Effect |
|---|---|
| `--check` | Exit non-zero if any file would change; prints the list. |
| `--list-different` | Like `--check`, prints only paths. |
| `--write` | Rewrite files in place. |
| `--rules=<a,b>` | Restrict the active rule set (still phase-ordered). |
| `--config <path>` | Explicit config file (otherwise cosmiconfig discovery). |
| `--stdin-filepath <p>` | Read stdin, write formatted text to stdout. |
| `--verbose` | Per-rule summary in `--check` output. |
| `--progress` | Force progress output to stderr, including completed/total work and ETA. |
| `--no-progress` | Disable automatic progress output. |

`--check`, `--write`, and `--list-different` are mutually exclusive.

Progress is shown automatically when stderr is an interactive terminal. It is
written to stderr so stdout stays stable for `--check` and `--list-different`.

## Build Targets

```sh
npm run build:lib
npm run build:node
npm run build
```

`build:lib` emits the package library files and types under `dist/`.
`build:node` creates `dist/bsprettier.cjs`, a single bundled JavaScript file
that can be run directly with Node:

```sh
node dist/bsprettier.cjs "components/**/*.{brs,bs,xml}" --check
```

`build` runs both targets.

### Exit codes

- `0` — clean, or `--write` succeeded.
- `1` — `--check` found formatting changes are needed.
- `2` — parse error, intra-phase edit conflict, write failure, or another
  formatting error.
- `3` — CLI usage or config error.

## Relationship to bsfmt and bslint

`bsprettier` integrates [`brighterscript-formatter`](https://github.com/rokucommunity/brighterscript-formatter) (bsfmt) internally. When formatting `.brs` and `.bs` files, `bsprettier` runs bsfmt before custom rules to normalize basic layout, spacing, casing, and indentation, then runs it again after custom rules to clean up layout drift from moved declarations. When `--rules` is used, bsfmt runs only if `brs/format-style` is included.

| Concern | Integrated bsfmt | bslint | bsprettier AST rules |
|---|---|---|---|
| Indentation, keyword case, trailing ws | **yes** (pre/post) | no | no |
| Import sorting (`.bs`) | **yes** (default `sortImports`) | no | no |
| Condition parentheses (presence) | no | yes (`group`) | no, but depends on it |
| Condition paren **spacing** `if(` | no | no | **yes** |
| Inline-if `then` presence | no | yes | no |
| Inline-if → block conversion | no | no | **yes** |
| Final newline | no | yes (`eol-last`) | **yes** |
| Top-level routine cohort order | no | no | **yes** |
| Blank-line count between routines | no | no | **yes** |
| XML script/interface/attribute order | no | no | **yes** |
| `onChange` field avoidance | no | no | **yes** (diagnostic, project-mode migration) |

### Formatter Configuration

You can customize `brighterscript-formatter` settings via the `"formatter"` key in `bsprettier.json`. 

#### Default Formatter Options
`bsprettier` comes pre-configured with the following default formatter options:
```json
{
  "formatter": {
    "indentStyle": "spaces",
    "indentSpaceCount": 4,
    "formatIndent": true,
    "keywordCase": "lower",
    "typeCase": "title",
    "compositeKeywords": "split",
    "removeTrailingWhiteSpace": true,
    "formatInteriorWhitespace": true,
    "insertSpaceBeforeFunctionParenthesis": false,
    "insertSpaceBetweenEmptyCurlyBraces": false,
    "insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces": true,
    "insertSpaceBetweenAssociativeArrayLiteralKeyAndColon": false,
    "formatSingleLineCommentType": "singlequote",
    "formatMultiLineObjectsAndArrays": true,
    "sortImports": true
  }
}
```

#### Overriding & Disabling
- **To override options:** Add the `"formatter"` block in your `bsprettier.json` containing only the options you want to change (they will merge with the defaults).
- **To disable formatting entirely:** Set `"formatter": null` in `bsprettier.json`.

Recommended full-project pipeline:

```sh
bslint  --fix
bsprettier "components/**/*.{brs,bs,xml}" --write
```

`.bs`/`.brs` import statements are sorted by the default bsfmt `sortImports`
option. SceneGraph XML `<script>` tags are sorted separately by
`xml/script-order`.

## Rule catalog

### BRS / BS rules (phase-ordered)

| Rule | Phase | Behavior |
|---|---|---|
| `brs/format-style` | pre/post | Runs `brighterscript-formatter` unless `formatter` is `null`. Included by default; with `--rules`, include this rule id explicitly to run bsfmt. |
| `brs/declaration-order` | A | Reorders whole top-level `sub`/`function` declarations into cohorts: `init`, Public, Private, Observer (`_on*` / `onKeyEvent`); ASCII-sorted within a cohort. File headers stay in place and standalone comments between routines travel with the routine below. Refuses on interleaved namespace/class/other top-level declarations or multiple `init` routines. |
| `brs/declaration-spacing` | B | Enforces exactly `brs.blankLinesBetweenRoutines` (default 3) blank lines between top-level routines and a single trailing newline. |
| `brs/block-if-form` | C | Converts a single-statement, no-`else` inline `if … then …` into block form. Preserves the condition's paren state byte-for-byte. Skips ambiguous cases. |
| `brs/if-condition-parens` | D | Enforces the spelling `if(condition)` / `else if(condition)` — no space between keyword and `(`. Only when the condition is already fully parenthesized; otherwise emits an `info` diagnostic. |

Phases run as a fixed pipeline, re-parsing between phases so later phases never
see stale offsets.

### XML rules

| Rule | Behavior |
|---|---|
| `xml/attribute-order` | `id` first (`name` for `<component>` and `<function>`), remaining attributes ASCII-ascending. Preserves quote style and multi-line attribute layout. |
| `xml/script-order` | Current-directory script URIs first, then all remaining path/protocol URIs; each group sorts ASCII-ascending by full `uri`. Refuses if `<script>` elements are not contiguous siblings or if comments cannot be moved safely. |
| `xml/interface-section-order` | Orders `<interface>` children into Events → Properties → Functions and sorts within a section. With section-header comments, keeps headers as fixed run boundaries and sorts within each run. Refuses to reorder if any field's Event/Property classification is ambiguous. |
| `xml/no-onchange-field` | Flags `onChange="…"` on `<field>`, recommends `observeFieldScoped` in `init()`, and in CLI project mode can remove `onChange`, create/extend `init`, and rename old handlers when safe. |

### Audit rules

| Rule | Behavior |
|---|---|
| `audit/handler-intent` | Compatibility no-op. Observer handler names are handled by `audit/private-member-naming`; `_set<Field>` is enforced only during XML `onChange` migration. |
| `audit/ui-node-prefix` | Component-local `findNode(...)` handles should be `m._ui*`; Animation and Interpolator handles use a private `_` prefix instead. Scene component scripts and scene-level `findNode(...)` receivers are exempt. Safe renames are auto-fixed across sibling component scripts. |
| `audit/private-member-naming` | Private `m` members should be lowerCamelCase with optional `_`; ALL_CAPS constants keep uppercase and gain `_` if needed. In project mode, component-local routines not declared in the XML interface are private unless framework or namespaced-global helpers. Safe renames update declarations, bare calls, observer strings, and sibling call sites. `_`-prefixed XML interface functions are reported but not auto-promoted. |
| `audit/hardcoded-string` | Diagnostic-only by default off. Flags direct non-empty string literals assigned to `.text`; use `ResourceUtil_getString(...)`. |
| `audit/prefer-dreamsocket-utils` | Diagnostic-only by default off. Flags selected builtin calls and recommends Dreamsocket helper namespaces such as `StringUtil_*` and `TypeUtil_*`. |

## XML field classification

`xml/interface-section-order` classifies fields as Events, Properties, or
ambiguous before sorting:

- Boolean-state names beginning with `is`, `has`, `can`, or `should` are
  Properties.
- Events require both an event-like name (`-ed`, `-ing`, `complete`, `ready`,
  or `done`) and evidence that the field is produced by the component.
- A field is produced when a linked script assigns `m.top.<fieldId>` or the
  field has an `alias=` attribute. Event-like fields without that backing are
  Properties.
- Non-tensed names remain Properties even when written.
- Standalone state participles such as `expanded` can be ambiguous when both
  read and written; resolve those with `xml.fieldClassificationOverrides`.

## Configuration

Discovered via cosmiconfig: a `bsprettier` key in `package.json`,
`bsprettier.json`, `bsprettier.config.json`, `.bsprettierrc.json`, or
`.bsprettierrc`. See
[`bsprettier.schema.json`](./bsprettier.schema.json) for the full shape.

```json
{
  "include": ["components/**/*.{brs,bs,xml}"],
  "ignore": ["**/roku_modules/**"],
  "rules": {
    "brs/declaration-order": "error",
    "xml/no-onchange-field": "warn",
    "audit/hardcoded-string": "off"
  },
  "brs": { "blankLinesBetweenRoutines": 3 },
  "xml": {
    "interfaceSectionComments": "preserve",
    "fieldClassificationOverrides": {
      "components/app/content/Foo.xml": {
        "dismissClicked": "event",
        "data": "property"
      }
    }
  }
}
```

Severity: `error` and `warn` both report diagnostics and apply safe fixes.
`--check` fails when output would change or a parse/conflict error occurs;
diagnostic-only messages do not currently change the exit status. `info` is
diagnostic-only, and `off` disables a rule.

### Inline suppression

- `' bsprettier-disable` — whole file (must be the first non-blank line).
- `' bsprettier-disable-next-line [ruleId,…]`
- XML: `<!-- bsprettier-disable -->` / `<!-- bsprettier-disable-next-line -->`

## Format-on-save and AI-agent use

Per file via stdin:

```sh
bsprettier --stdin-filepath components/foo/Bar.brs < Bar.brs
```

Per tree for agents:

```sh
bsprettier "components/foo/**/*.{brs,bs,xml}" --write
```

## Programmatic API

```ts
import { formatText, loadConfig } from "@dreamsocket/bsprettier";

const result = formatText("components/foo/Bar.brs", source, loadConfig());
if (result.changed) console.log(result.output);
```

## License

MIT
