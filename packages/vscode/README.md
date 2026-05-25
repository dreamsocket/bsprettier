# bsprettier VSCode extension

Formatter integration for VSCode and Cursor. This extension does not replace
the RokuCommunity BrighterScript extension; keep that installed for language
services, diagnostics, debugging, deploy tasks, and symbol navigation.

## Settings

```json
{
  "[brightscript]": {
    "editor.defaultFormatter": "dreamsocket.bsprettier-vscode"
  },
  "[brighterscript]": {
    "editor.defaultFormatter": "dreamsocket.bsprettier-vscode"
  },
  "bsprettier.editor.mode": "project"
}
```

Modes:

- `project` keeps a warm workspace source map and `ProjectContext`, so linked
  XML/component rules such as `audit/private-member-naming` run on save.
- `singleFile` mirrors `bsprettier --stdin-filepath` and is useful as a
  compatibility fallback.

Expected performance is measured after warmup. The target is 10-40ms for common
project-aware saves and under roughly 100ms for normal linked-component saves.
Cold activation and first-format cache population are measured separately.

## Development

```sh
npm install
npm run build:lib
npm run build:vscode
```

The extension package imports `@dreamsocket/bsprettier` in-process so repeated
format-on-save requests do not pay the cold Node/BrighterScript startup cost.
