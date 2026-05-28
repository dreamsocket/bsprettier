# bsprettier

VSCode compatible IDE extension that formats **BrightScript** (`.brs`),
**BrighterScript** (`.bs`), and **SceneGraph XML** (`.xml`) files.

This extension does not replace the RokuCommunity BrighterScript extension; keep
that installed for language services, diagnostics, debugging, deploy tasks, and
symbol navigation. bsprettier owns only formatting, and keeps itself and
BrighterScript warm in the editor host so on-save formatting avoids the ~400ms
cold start a fresh CLI process pays.

## Install

Download the VSIX attached to the latest
[GitHub Release](https://github.com/dreamsocket/bsprettier/releases) and run
`Extensions: Install from VSIX...`. Once published, it will also be installable
from Open VSX by searching **bsprettier** in the Extensions view.

## Settings

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

### Configuration

The extension uses the same shared config file as the CLI. Put project config in
`bsprettier.json` or another supported config location, or set
`bsprettier.configPath` to an explicit path relative to the workspace root.

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
for discovery rules, severity behavior, formatter options, and schema details. For
the full rule list and convention behavior, see the
[code conventions reference](https://github.com/dreamsocket/bsprettier/blob/main/docs/code-conventions.md).

### Modes

- `project` keeps a warm workspace source map and project context, so linked
  XML/component rules such as `audit/private-member-naming` run on save.
- `singleFile` mirrors `bsprettier --stdin-filepath` and is useful as a
  compatibility fallback.

Both modes load config fresh per format request, so config edits are picked up
without reloading the editor.

Project mode reads saved workspace files for linked XML/BRS context, then
overlays the document being formatted with its current editor text. The
extension does not live-analyze or rebuild project context on every keystroke;
unsaved sibling documents are picked up after they are saved.

## XML formatting on save

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

## License

MIT — see [`LICENSE`](./LICENSE). For architecture, build details, and
contributing, see the
[repository](https://github.com/dreamsocket/bsprettier).
