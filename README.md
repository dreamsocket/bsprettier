<p align="center">
  <img src="packages/vscode-extension/icon.png" alt="bsprettier" width="128" height="128" />
</p>

# bsprettier

An opinionated formatter and convention auditor for **BrightScript** (`.brs`),
**BrighterScript** (`.bs`), and **SceneGraph XML** (`.xml`) files, built to
Dreamsocket conventions.

bsprettier is deterministic, idempotent, and safe to run on save or after
AI-generated edits.

## Packages

This is a monorepo of two independently versioned artifacts:

- [`packages/cli`](./packages/cli) — `@dreamsocket/bsprettier`, the command-line
  formatter and programmatic API. See its README for install, usage, flags,
  configuration, suppression, and API details.
- [`packages/vscode-extension`](./packages/vscode-extension) — `bsprettier-vscode`,
  the VSCode compatible formatter extension. See its README for install,
  settings, modes, and on-save behavior.

## Documentation

- [`docs/code-conventions.md`](./docs/code-conventions.md) — the rule and
  convention reference: formatting pipeline, default styles and rule set, and the
  BRS/BS/XML/audit conventions enforced.
- [`docs/vscode-extension.md`](./docs/vscode-extension.md) — extension internals:
  architecture, key files, and the load-bearing build constraints.
- [`docs/configuration.md`](./docs/configuration.md) — shared CLI and extension
  config: discovery, `bsprettier.json`, severity, formatter options, and schema.
- [`docs/performance.md`](./docs/performance.md) — how performance was implemented
  and how it is measured.
- [`docs/releases.md`](./docs/releases.md) — releases, versions, tags, and
  distribution channels.
- [`docs/index.md`](./docs/index.md) — docs hub.

## Development

npm-workspaces monorepo (`packages/cli`, `packages/vscode-extension`):

```sh
npm install
npm run build           # build:lib (CLI runtime) + build:vscode (type-check only)
npm run package:vscode  # produces packages/vscode-extension/*.vsix
npm test
npm run typecheck
```

- `build:lib` compiles the CLI to `packages/cli/dist/` — this is the
  runtime artifact loaded by `bin/bsprettier.js`.
- `build:vscode` runs `tsc` on the extension for type-checking; its emitted
  `.js` is **not** what VS Code loads. The loadable bundle
  (`dist/extension.cjs`) and `.vsix` are produced by `package:vscode`.

## License

MIT — see [`LICENSE`](./LICENSE). Each published package carries its own copy.
