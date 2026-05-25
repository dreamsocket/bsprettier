# VS Code / Cursor extension — outline

As-built outline of the `bsprettier` editor extension. It documents the shape
that shipped; it is not a plan. CLI-package paths are relative to
`packages/cli/`; extension paths are relative to `packages/vscode-extension/`.

## What it is

A VS Code/Cursor formatter extension that keeps `bsprettier` and BrighterScript
warm inside the editor extension host, so on-save formatting avoids the ~400ms
cold BrighterScript load that a fresh CLI process pays (see
[`performance.md`](./performance.md)). It owns **only** formatting via VS Code's
`DocumentFormattingEditProvider` API and coexists with the RokuCommunity
BrighterScript extension, which keeps owning language intelligence.

- Package: `bsprettier-vscode` (publisher `dreamsocket`), displayName
  `bsprettier`.
- Activates on `brightscript`, `brighterscript`, and `xml` languages, on startup,
  and on its format command.
- The user selects it via `editor.defaultFormatter`; it does not hook
  BrighterScript's private internals.

## Two formatting modes

Setting `bsprettier.editor.mode`, default `project`:

- **`project`** — project-aware. Builds an in-memory `projectSources` map and a
  warm `ProjectContext`, so linked XML/component rules work on save — notably
  routine privatization in `audit/private-member-naming` and XML interface
  classification, which depend on sibling scripts and `<interface>` declarations.
- **`singleFile`** — a fallback that is byte-identical to the CLI
  `--stdin-filepath` path: `loadConfig` fresh, `formatFile` with no
  `projectSources`/`projectContext`. Used when project indexing isn't available
  or the lowest-risk path is wanted.

Both modes load config fresh per format request, so config edits are picked up
without reloading the editor.

## Architecture

```
VS Code/Cursor format request
        │
        ▼
extension host (packages/vscode-extension/src/extension.ts)
        │  mode?
        ├─ singleFile ─▶ src/editor.ts (single-file helper)
        └─ project ────▶ src/editor/workspace-service.ts
                              │  warm projectSources + ProjectContext
                              ▼
                         loadConfig (fresh) ─▶ formatFile ─▶ TextEdits
```

The same path backs the CLI: `src/cli.ts` stdin mode routes through the
single-file helper, so CLI stdin, the extension's single-file fallback, and the
extension's project mode share one editor-format implementation and cannot
diverge.

## Key files

CLI package (`packages/cli/`):

- `src/editor.ts` — shared single-file editor helpers backing CLI stdin mode and
  the extension's single-file fallback.
- `src/editor/workspace-service.ts` — project-aware warm formatting service
  (`projectSources` + `ProjectContext`).
- `src/project/discovery.ts` — file discovery shared with the CLI.
- `src/project/context.ts` — cross-file `ProjectContext`; lazy BRS parse via
  `getBrsParse`.
- `src/edit/runner.ts` — `formatFile`, used by every mode.
- `src/index.ts` — public exports, including the editor helpers and workspace
  service.
- `scripts/bench-editor.ts` — editor latency/memory benchmark (`npm run
  bench:editor`).
- `test/unit/editor.test.ts`, `test/unit/workspace-service.test.ts` — editor and
  linked-rule coverage.

Extension package (`packages/vscode-extension/`):

- `package.json` — manifest, `bsprettier.editor.mode` setting, activation, bundle
  and package scripts.
- `src/extension.ts` — the formatter provider and lifecycle.
- `README.md`, `LICENSE` — VSIX contents.

## Build and package

From the repo root:

```sh
npm run build:all        # builds packages/cli then packages/vscode-extension
npm run package:vscode   # build:all + esbuild bundle + vsce package (VSIX)
```

The extension bundles with esbuild to `dist/extension.cjs`, then `vsce package
--no-dependencies`. The current VSIX (~0.96 MB) is verified byte-identical to the
CLI across the corpus. Distribution targets the VSIX as a GitHub Release asset
plus Open VSX; the core CLI install stays unbundled and Git-based.

### Build constraints (do not drop these flags)

These bundle flags are load-bearing — dropping any one silently breaks the VSIX:

- **`--keep-names` is mandatory.** esbuild renames classes while bundling, but
  BrighterScript's AST visitor matches node types *by class name*. Without it,
  single-line-`if` detection finds zero `IfStatement`s and mis-formats (e.g. a
  one-line `if … then … else …` loses indentation). With it, the bundle is
  byte-identical to the CLI across the whole corpus. (Shipped 0.1.6 had this bug.)
- **`--main-fields=module,main` is mandatory.** Otherwise esbuild resolves
  `jsonc-parser`'s UMD entry, which keeps a runtime `require("./impl/format")`
  that isn't in the VSIX — activation then fails with
  `Cannot find module './impl/format'`.
- **`roku-deploy` and `typescript` are aliased to `stub-empty.cjs`.** They are
  pulled transitively by `brighterscript-formatter` → `brighterscript`'s barrel
  but never exercised on the format path. `stub-empty.cjs` is a build-time input
  only; it is not shipped in the VSIX. (This is most of the ~19 MB → ~4.2 MB
  bundle reduction.)

For local VSIX testing, **bump the extension `version` before each rebuild** —
Cursor/VSCode key installs by version, so reusing a version can leave the stale
bundle loaded. (Once release-please owns versioning, the release PR does this; see
`RELEASE_HANDOFF.md`.)

## Coexistence with BrighterScript

The BrighterScript extension's own formatter delegates to
`brighterscript-formatter`. Selecting `bsprettier` as the default formatter does
not lose a hidden formatting layer; output differences come from formatter
options/defaults and `bsprettier`'s additional rules. `bsprettier` stays
narrower than a language server: no diagnostics, completions, deploy, or debug.

## State and correctness posture

The extension host is long-lived, so the risks are stale config, stale source
snapshots, and stale project context. Mitigations as built: fresh config per
request, source-change tracking for open/saved/deleted files, conservative
`ProjectContext` rebuilds (no fine-grained incremental invalidation), and a
single-file fallback when the project service is uncertain. Parse/conflict
results leave the document unchanged and surface a message rather than throwing.

## Related

- User-facing install, settings, and the XML save chain: the repo `README.md`
  (§ Editor integration).
- Performance background and measurement: [`performance.md`](./performance.md).
