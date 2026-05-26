# Versioning

The canonical description of *how versions and releases work* for this repo. The
implementation (CI, release automation, work packages) lives in
[`../RELEASE_HANDOFF.md`](../RELEASE_HANDOFF.md).

This is a monorepo of independently built, tested, versioned, and published
artifacts:

- **CLI / library** — `@dreamsocket/bsprettier`
- **VS Code extension** — `bsprettier-vscode`

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

There is **no repo-wide or dated umbrella tag**. Each artifact releases on its
own track; change magnitude lives in each artifact's semver (major = breaking,
minor = feature, patch = fix), driven by conventional commits.

## GitHub Releases = one release per artifact

There is no coordinated "release train" / compatibility bundle. release-please
creates **one GitHub Release per artifact release**, automatically, when its
release PR is merged:

- A `cli-v*` release — body is the CLI changelog (features / fixes / breaking).
- A `vscode-v*` release — body is the extension changelog; the VSIX is attached
  as an asset.

The repo's Releases page shows the two streams interleaved by date, each prefixed
by component, so the per-artifact history (and where the larger changes are)
stays directly readable.

Because the extension bundles the CLI, the **extension release effectively names
the user-facing bundle** — its version already implies which CLI is inside. To
keep a single obvious "current" entry, the extension release is marked GitHub
"Latest"; CLI releases are marked not-latest.

## Distribution channels

- **CLI**: git install today — `npm i github:dreamsocket/bsprettier` (the
  `prepare` script builds it on install). Publishing to **npmjs.org** is planned
  but deferred.
- **Extension**: the **VSIX** is attached to the `vscode-v*` GitHub Release
  **and** published to **Open VSX** (the registry other VS Code compatible IDEs install from). The
  Microsoft Marketplace is an optional future channel.

## Why a monorepo (not separate repos)

Shared code/types/config, shared CI and tests, easier compatibility validation,
and simpler coordinated releases. We would split into separate repos only if
ownership, release cadence, governance, permissions, or issue tracking diverge
significantly. Current layout: `packages/cli/` (`@dreamsocket/bsprettier`) and
`packages/vscode-extension/` (`bsprettier-vscode`), with an optional
`packages/core/` if shared code is later extracted.
