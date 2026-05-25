<p align="center">
  <img src="packages/vscode-extension/icon.png" alt="bsprettier" width="128" height="128" />
</p>

# bsprettier

An opinionated formatter and convention auditor for **BrightScript** (`.brs`),
**BrighterScript** (`.bs`), and **SceneGraph XML** (`.xml`) files, built to
Dreamsocket conventions.

bsprettier is deterministic, idempotent, and safe to run on save or after
AI-generated edits.

## Quick start

```sh
npm install --save-dev github:dreamsocket/bsprettier
bsprettier "components/**/*.{brs,bs,xml}" --write
```

See [`packages/cli`](./packages/cli) for full CLI usage, configuration, and the
programmatic API; install the editor extension from
[`packages/vscode-extension`](./packages/vscode-extension).

## Packages

This is a monorepo of two independently versioned artifacts:

- [`packages/cli`](./packages/cli) — `@dreamsocket/bsprettier`, the CLI and
  library. Install, usage, flags, configuration, suppression, programmatic API.
- [`packages/vscode-extension`](./packages/vscode-extension) — `bsprettier-vscode`,
  the VSCode/Cursor formatter extension. Install, settings, modes, on-save
  behavior.

## Documentation

- [`docs/code-conventions.md`](./docs/code-conventions.md) — the rule and
  convention reference: formatting pipeline, default styles and rule set, and the
  BRS/BS/XML/audit conventions enforced.
- [`docs/vscode-extension.md`](./docs/vscode-extension.md) — extension internals:
  architecture, key files, and the load-bearing build constraints.
- [`docs/performance.md`](./docs/performance.md) — how performance was implemented
  and how it is measured.
- [`docs/versioning.md`](./docs/versioning.md) — versions, tags, releases, and
  distribution channels.
- [`docs/index.md`](./docs/index.md) — docs hub.

For in-progress distribution / CI / release work, see [`ROADMAP.md`](./ROADMAP.md).

## Development

npm-workspaces monorepo (`packages/cli`, `packages/vscode-extension`):

```sh
npm install
npm run build        # build:lib + build:vscode
npm test
npm run typecheck
```

## License

MIT — see [`LICENSE`](./LICENSE). Each published package carries its own copy.
