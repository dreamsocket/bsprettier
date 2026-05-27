# @dreamsocket/bsprettier

An opinionated formatter and convention auditor for **BrightScript** (`.brs`),
**BrighterScript** (`.bs`), and **SceneGraph XML** (`.xml`) files, built to
Dreamsocket conventions.

bsprettier is deterministic, idempotent, and safe to run on save or after
AI-generated edits. An editor extension is also available — see
[bsprettier-vscode](https://github.com/dreamsocket/bsprettier/tree/main/packages/vscode-extension).

## Install

Installed from Git today (npmjs publishing is planned but deferred):

For a stable install, pin a CLI release tag:

Current stable CLI tag: `cli-v0.1.1` <!-- x-release-please-version -->

```sh
npm install --save-dev github:dreamsocket/bsprettier#cli-v0.1.1 # x-release-please-version
```

For a global stable install:

```sh
npm install -g github:dreamsocket/bsprettier#cli-v0.1.1 # x-release-please-version
```

To track the current `main` branch instead of the latest stable release, omit the
tag:

```sh
npm install --save-dev github:dreamsocket/bsprettier
```

The `prepare` script builds the package on install. A local dev dependency links
`bsprettier` into `node_modules/.bin`; npm scripts can use it directly, but your
interactive shell will not see it as `bsprettier` unless you install globally or
put `node_modules/.bin` on `PATH`.

Recommended local project scripts:

```json
{
  "scripts": {
    "format": "bsprettier \"components/**/*.{brs,bs,xml}\" --write",
    "format:check": "bsprettier \"components/**/*.{brs,bs,xml}\" --check"
  }
}
```

```sh
npm run format
```

For a one-off local run without adding a script:

```sh
npx --no-install bsprettier "components/**/*.{brs,bs,xml}" --write
```

## Usage

Use these commands directly after a global install, or inside npm scripts after a
local install:

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
| `-h`, `--help` | Show CLI usage and options. |

`--check`, `--write`, and `--list-different` are mutually exclusive.

Progress is shown automatically when stderr is an interactive terminal. It is
written to stderr so stdout stays stable for `--check` and `--list-different`.

## Configuration

The CLI uses the shared bsprettier config file. Put config in `bsprettier.json`
or another supported config location, or pass an explicit path with `--config`.

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

See the
[configuration reference](https://github.com/dreamsocket/bsprettier/blob/main/docs/configuration.md)
for discovery rules, severity behavior, formatter options, and schema details.

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
