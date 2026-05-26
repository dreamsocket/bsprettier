# Configuration

bsprettier uses the same configuration file for the CLI and the VS Code
extension. The extension loads config fresh for each format request, so changes
to config files are picked up without reloading the editor.

## Discovery

Config is discovered with cosmiconfig. Put config in any of these places:

- A `bsprettier` key in `package.json`
- `bsprettier.json`
- `bsprettier.config.json`
- `.bsprettierrc.json`
- `.bsprettierrc`

The CLI can also receive an explicit config path:

```sh
bsprettier "components/**/*.{brs,bs,xml}" --write --config bsprettier.json
```

The VS Code extension can receive an explicit path with
`bsprettier.configPath`, relative to the workspace root:

```json
{
  "bsprettier.configPath": "bsprettier.json"
}
```

If no explicit path is set, both the CLI and extension use config discovery.

## Example

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

## Rules

Rule severity can be `error`, `warn`, `info`, or `off`.

`error` and `warn` both report diagnostics and apply safe fixes. `--check` fails
when output would change or a parse/conflict error occurs; diagnostic-only
messages do not currently change the exit status. `info` is diagnostic-only, and
`off` disables a rule.

See the
[code conventions reference](https://github.com/dreamsocket/bsprettier/blob/main/docs/code-conventions.md)
for the full rule list and behavior.

## Formatter Options

`brighterscript-formatter` options can be partially overridden with the top-level
`formatter` key:

```json
{
  "formatter": {
    "indentSpaceCount": 2
  }
}
```

Set `"formatter": null` to disable the underlying formatter and run only
bsprettier rules.

## Schema

The JSON schema is available at
[`packages/cli/bsprettier.schema.json`](https://github.com/dreamsocket/bsprettier/blob/main/packages/cli/bsprettier.schema.json).
