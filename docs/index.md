# docs

As-built documentation for bsprettier internals. Start here.

- [performance.md](./performance.md) — how the formatter's performance was
  implemented: the two workloads, what shipped (~1.7x), how to measure, and what
  was deliberately not pursued.
- [vscode-extension.md](./vscode-extension.md) — outline of the VS Code compatible extension: modes, architecture, key files, and build/packaging.
- [versioning.md](./versioning.md) — how versions and releases work: independent
  artifact versions, tag scheme, per-artifact releases, and distribution
  channels.
- [code-conventions.md](./code-conventions.md) — the rule and convention
  reference: the formatting pipeline, default BRS/BS and XML styles, every rule's
  behavior, audit conventions, and the default rule set.

For the in-progress distribution / CI / release work, see `ROADMAP.md` at the
repo root.
