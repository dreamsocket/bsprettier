# Versioning

The canonical description of *how versions and releases work* for this repo. The
implementation (CI, release automation, work packages) lives in
[`../RELEASE_HANDOFF.md`](../RELEASE_HANDOFF.md).

This is a monorepo of independently built, tested, versioned, and published
artifacts:

- **CLI / library** — `@dreamsocket/bsprettier`
- **VS Code / Cursor extension** — `bsprettier-vscode`

## Independent artifact versions

Each package owns its own semantic version in its own `package.json` and may
release on its own cadence (independent patches, hotfixes, etc.). Example: CLI
`1.4.0`, extension `0.8.2`. Extension-only changes bump **only** the extension;
CLI-only changes bump the CLI.

## Artifact relationship (current)

The extension **bundles the CLI at build time** — esbuild inlines
`@dreamsocket/bsprettier` into the VSIX. Consequence: **a CLI change requires a
new extension release** so the bundled copy is updated. This propagation is
automated (the release tooling bumps the extension whenever the CLI it depends on
changes). The reverse does not hold — extension-only changes never bump the CLI.

> Future option: switch the extension to consume the *published* CLI (the
> Prettier/ESLint "use the project's install" model) instead of bundling. That
> makes versioning fully trivial but depends on the CLI being published to npm.
> See `../RELEASE_HANDOFF.md`.

## Git tag conventions

Artifact-scoped tags keep Git history unambiguous about *what* released:

- `cli-vX.Y.Z` — a CLI release
- `vscode-vX.Y.Z` — an extension release
- `release-vYYYY.MM.DD` — a coordinated compatibility bundle (a "release train")

## GitHub Releases = compatibility bundles

A `release-vYYYY.MM.DD` GitHub Release is a **snapshot of known-good artifact
versions**, not a single artifact's version. Its notes list every artifact
version and link to the per-artifact changelogs. Example:

```text
Release v2026.05.25

Artifacts:
- CLI: 1.4.0
- VS Code Extension: 0.8.2
```

Per-artifact tags/releases (`cli-v*`, `vscode-v*`) carry the detailed changelog
for that artifact; the dated release train ties a set together for users.

> The biggest source of user confusion in projects like this is assuming
> "one GitHub Release = one artifact version." The dated release train plus the
> explicit artifact list in the notes is how we avoid that.

## Distribution channels

- **CLI**: git install today — `npm i github:dreamsocket/bsprettier` (the
  `prepare` script builds it on install). Publishing to **npmjs.org** is planned
  but deferred.
- **Extension**: the **VSIX** is attached to the GitHub Release **and** published
  to **Open VSX** (the registry Cursor installs from). The Microsoft Marketplace
  is an optional future channel.

## Why a monorepo (not separate repos)

Shared code/types/config, shared CI and tests, easier compatibility validation,
and simpler coordinated releases. We would split into separate repos only if
ownership, release cadence, governance, permissions, or issue tracking diverge
significantly. Current layout: `packages/cli/` (`@dreamsocket/bsprettier`) and
`packages/vscode-extension/` (`bsprettier-vscode`), with an optional
`packages/core/` if shared code is later extracted.
