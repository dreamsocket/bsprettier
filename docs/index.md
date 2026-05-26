# docs

As-built documentation for bsprettier internals. Start here.

- [performance.md](./performance.md) — how the formatter's performance was
  implemented: the two workloads, what shipped (~1.7x), how to measure, and what
  was deliberately not pursued.
- [vscode-extension.md](./vscode-extension.md) — outline of the VS Code compatible extension: modes, architecture, key files, and build/packaging.
- [releases.md](./releases.md) — how releases and versions work: independent
  artifact versions, tag scheme, per-artifact releases, and distribution
  channels.
- [configuration.md](./configuration.md) — shared CLI and extension config:
  discovery, `bsprettier.json`, severity, formatter options, and schema.
- [code-conventions.md](./code-conventions.md) — the rule and convention
  reference: the formatting pipeline, default BRS/BS and XML styles, every rule's
  behavior, audit conventions, and the default rule set.
