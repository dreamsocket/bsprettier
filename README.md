# bsprettier

An opinionated formatter and convention auditor for **BrightScript** (`.brs`),
**BrighterScript** (`.bs`), and **SceneGraph XML** (`.xml`) files, built to
Dreamsocket conventions.

bsprettier is deterministic, idempotent, and safe to run on save or after
AI-generated edits.

## Install

Installed from Git today (npmjs publishing is planned but deferred):

```sh
npm install --save-dev github:dreamsocket/bsprettier
```

The `prepare` script builds the package on install. See
[`docs/versioning.md`](./docs/versioning.md) for release/distribution details.

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
`.bsprettierrc`. See
[`bsprettier.schema.json`](./packages/cli/bsprettier.schema.json) for the full shape.

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

## Code conventions

See [CODE_CONVENTIONS.md](./CODE_CONVENTIONS.md) for the formatting pipeline,
default rule set, and the BrightScript, BrighterScript, SceneGraph XML, and
audit conventions enforced by `bsprettier`.

Recommended full-project pipeline:

```sh
bslint --fix
bsprettier "components/**/*.{brs,bs,xml}" --write
```

## Editor integration (VSCode / Cursor)

A companion formatter extension lives in `packages/vscode-extension`. Keep the
RokuCommunity BrighterScript extension installed for language services; the
bsprettier extension owns only formatting.

### Install

Build and package the VSIX (builds the library + extension, then runs `vsce`):

```sh
npm run package:vscode
```

In Cursor/VSCode: `Cmd+Shift+P` → `Extensions: Install from VSIX...` → select
`packages/vscode-extension/bsprettier-vscode-<version>.vsix` → reload. Bump the extension
`version` before each rebuild so the editor installs the new bundle instead of
reusing the cached one.

### Settings

```json
{
  "editor.formatOnSave": true,
  "[brightscript]": {
    "editor.defaultFormatter": "dreamsocket.bsprettier-vscode"
  },
  "[brighterscript]": {
    "editor.defaultFormatter": "dreamsocket.bsprettier-vscode"
  },
  "[xml]": {
    "editor.defaultFormatter": "redhat.vscode-xml"
  },
  "bsprettier.editor.mode": "project",
  "bsprettier.configPath": "bsprettier.json"
}
```

Language ids: `brightscript` = `.brs`, `brighterscript` = `.bs`. For `.brs`/`.bs`,
bsprettier is the default formatter and runs on save directly.

| Setting | Purpose |
|---|---|
| `bsprettier.editor.mode` | `project` (default) keeps a warm workspace model so linked XML/component rules run on save; `singleFile` mirrors the CLI `--stdin-filepath` fallback. |
| `bsprettier.configPath` | Optional explicit config path (relative to the workspace root). If omitted, config discovery searches upward. |
| `bsprettier.trace` | `false` by default. Set `true` to log per-format invocations, timings, and XML save-participant activity to the `bsprettier` output channel. Errors and fallbacks always log. |

### XML formatting on save

VSCode allows only one default formatter per language, so XML is handled as a
chain rather than a single formatter:

- Red Hat XML (`redhat.vscode-xml`) stays the `xml` default formatter and runs on
  save like any other XML.
- bsprettier additionally runs its Roku-specific passes on save for **component
  XML only** (files whose root is `<component>`), via a save participant.

Both passes run on save for component XML. The bsprettier pass honors
`editor.formatOnSave` and skips the `afterDelay` autosave, matching the built-in
formatter.

The `[xml]` default-formatter line is optional in practice but pins Red Hat
deterministically; without it, a later-installed XML formatter could silently
change which one runs on save.

## AI-agent use

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

## Build

```sh
npm run build
```

`build` runs `tsc` to emit the package library, CLI, and type declarations
under `packages/cli/dist/`. The `bsprettier` bin runs directly from that output; there is no
separate bundle step. To run the CLI from a build without the installed bin:

```sh
node packages/cli/dist/node.js "components/**/*.{brs,bs,xml}" --check
```

To build the VSCode/Cursor extension package:

```sh
npm run build:vscode
```

### Exit codes

- `0` — clean, or `--write` succeeded.
- `1` — `--check` found formatting changes are needed.
- `2` — parse error, intra-phase edit conflict, write failure, or another
  formatting error.
- `3` — CLI usage or config error.

## License

MIT
