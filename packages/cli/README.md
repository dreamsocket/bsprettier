# @dreamsocket/bsprettier

An opinionated formatter and convention auditor for **BrightScript** (`.brs`),
**BrighterScript** (`.bs`), and **SceneGraph XML** (`.xml`) files, built to
Dreamsocket conventions.

bsprettier is deterministic, idempotent, and safe to run on save or after
AI-generated edits. An editor extension is also available — see
[bsprettier-vscode](https://github.com/dreamsocket/bsprettier/tree/main/packages/vscode-extension).

## Install

Installed from Git today (npmjs publishing is planned but deferred):

```sh
npm install --save-dev github:dreamsocket/bsprettier
```

The `prepare` script builds the package on install.

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

## Configuration

Discovered via cosmiconfig: a `bsprettier` key in `package.json`,
`bsprettier.json`, `bsprettier.config.json`, `.bsprettierrc.json`, or
`.bsprettierrc`. See [`bsprettier.schema.json`](./bsprettier.schema.json) for the
full shape, and the
[code conventions reference](https://github.com/dreamsocket/bsprettier/blob/main/docs/code-conventions.md)
for what each rule does.

```json
{
  "include": ["components/**/*.{brs,bs,xml}"],
  "ignore": ["**/roku_modules/**"],
  "rules": {
    "brs/declaration-order": "error",
    "xml/no-onchange-field": "warn",
    "audit/hardcoded-string": "off"
  }
}
```

Severity: `error` and `warn` both report diagnostics and apply safe fixes.
`--check` fails when output would change or a parse/conflict error occurs;
diagnostic-only messages do not currently change the exit status. `info` is
diagnostic-only, and `off` disables a rule.

`brighterscript-formatter` options can be partially overridden with the top-level
`formatter` key, or disabled entirely with `"formatter": null`.

### Inline suppression

- `' bsprettier-disable` — whole file (must be the first non-blank line).
- `' bsprettier-disable-next-line [ruleId,…]`
- XML: `<!-- bsprettier-disable -->` / `<!-- bsprettier-disable-next-line -->`

## Programmatic API

```ts
import { WorkspaceFormatService, formatText, loadConfig } from "@dreamsocket/bsprettier";

const result = formatText("components/foo/Bar.brs", source, loadConfig());
if (result.changed) console.log(result.output);

const service = new WorkspaceFormatService({ cwd: process.cwd() });
const editorResult = service.format({
  mode: "project",
  filePath: "components/foo/Bar.brs",
  source,
});
```

## Exit codes

- `0` — clean, or `--write` succeeded.
- `1` — `--check` found formatting changes are needed.
- `2` — parse error, intra-phase edit conflict, write failure, or another
  formatting error.
- `3` — CLI usage or config error.

## License

MIT — see [`LICENSE`](./LICENSE).
