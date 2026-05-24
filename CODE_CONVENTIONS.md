# bsprettier Code Conventions

This document describes the BrightScript, BrighterScript, and SceneGraph XML
conventions enforced by the current `bsprettier` implementation. The source
code is the authority when this document and `bsprettier-plan.md` differ.

## Formatting Pipeline

- `.brs` and `.bs` files are parsed with BrighterScript before any edit. Files
  with fatal parse diagnostics are left unchanged.
- `.brs` and `.bs` files run through `brighterscript-formatter` before and
  after custom rules unless `formatter` is set to `null`. When `--rules` is
  used, the formatter runs only if `brs/format-style` is included.
- XML files are parsed with `@xml-tools/parser` and edited by source-offset
  splices. XML is never reserialized through a DOM.
- Rules run in numeric phase order, reparsing between phases.
- Edits from rules in the same phase must not overlap. A conflict leaves the
  file unchanged.
- Output is reparsed after the last phase. If it no longer parses, the original
  source is returned unchanged.
- Generated text uses the file's detected line ending.
- Suppression comments are honored:
  - BrightScript: `' bsprettier-disable` as the first non-blank line disables
    the whole file.
  - BrightScript: `' bsprettier-disable-next-line [ruleId,...]` suppresses the
    next line.
  - XML: `<!-- bsprettier-disable -->` as the first non-blank line disables the
    whole file.
  - XML: `<!-- bsprettier-disable-next-line [ruleId,...] -->` suppresses the
    next line.

## Default BRS/BS Style

The default `brighterscript-formatter` options are:

```json
{
  "indentStyle": "spaces",
  "indentSpaceCount": 4,
  "formatIndent": true,
  "keywordCase": "lower",
  "typeCase": "title",
  "compositeKeywords": "split",
  "removeTrailingWhiteSpace": true,
  "formatInteriorWhitespace": true,
  "insertSpaceBeforeFunctionParenthesis": false,
  "insertSpaceBetweenEmptyCurlyBraces": false,
  "insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces": true,
  "insertSpaceBetweenAssociativeArrayLiteralKeyAndColon": false,
  "formatSingleLineCommentType": "singlequote",
  "formatMultiLineObjectsAndArrays": true,
  "sortImports": true
}
```

These options can be partially overridden with the top-level `formatter`
config key.

## BRS/BS Declaration Order

Top-level routines are ordered into these cohorts:

1. `init`
2. Public routines
3. Private routines
4. Observer routines

Classification rules:

- `init` is case-insensitive and sorts first.
- `onKeyEvent` is an observer and sorts as `_onKeyEvent`.
- Names beginning with `_on` are observers.
- Other names beginning with `_` are private.
- All other routines are public.
- Routines sort ASCII-ascending within a cohort, using case-sensitive JavaScript
  string order.

The rule refuses to reorder if top-level routines are interleaved with other
top-level statement kinds, or if more than one `init` exists. When it reorders,
the file-level header before the first routine stays in place. A standalone
comment line found between two routines is attached to the routine below and
moves with it.

## BRS/BS Routine Spacing

- Consecutive top-level routines are separated by exactly
  `brs.blankLinesBetweenRoutines` blank lines. The default is `3`.
- Gaps containing non-whitespace are not changed by the spacing rule.
- If the tail after the last routine is whitespace-only, it is normalized to
  exactly one trailing newline.

## BRS/BS Inline If Form

Single-line inline `if` statements are converted to block form only when all of
these are true:

- The node is an inline `if`.
- There is exactly one consequent statement.
- There is no `else` or `else if`.
- The condition and consequent statement are both single-line.
- There is no trailing same-line text or comment after the consequent.
- The file indentation unit can be detected.

The conversion preserves the condition text byte-for-byte. It does not add or
remove condition parentheses; the later condition-spacing rule handles spacing
only when parentheses already exist.

Example:

```brightscript
if (m.ready) then m.count = 1
```

becomes:

```brightscript
if (m.ready)
    m.count = 1
end if
```

## BRS/BS If Condition Spacing

For parenthesized `if` conditions, whitespace between the `if` token and the
opening parenthesis is removed:

```brightscript
if(m.ready)
```

The rule does not add missing parentheses. Non-parenthesized conditions emit an
informational diagnostic and are otherwise left alone. Comments between `if`
and `(` prevent the edit.

## XML Attribute Order

Attributes are reordered within the original attribute block while preserving
quote style and inter-attribute whitespace:

- `<component>` and `<function>` pin `name` first.
- All other elements pin `id` first when present.
- Remaining attributes sort ASCII-ascending, case-sensitive.

## XML Script Order

`<script>` siblings under the root `<component>` are reordered only when all
script elements form one contiguous sibling run. If a non-script child sits
between script elements, the rule emits a diagnostic and leaves them unchanged.

Ordering rules:

- Current-directory script URIs sort first. A current-directory URI has no URI
  scheme and no slash, for example `Widget.brs`.
- Current-directory scripts sort ASCII-ascending by full `uri`.
- All remaining scripts sort ASCII-ascending by full `uri`.
- A comment on its own line directly above a script moves with that script.
- Floating comments, trailing same-line comments, and section-header comments
  make the reorder unsafe and prevent the edit.

## XML Interface Order

Inside `<interface>`, children must be only `<field>` or `<function>` elements.
Any other child element prevents reordering.

Without section headers, members are gathered and sorted as:

1. Event fields, sorted by `id`
2. Property fields, sorted by `id`
3. Functions, sorted by `name`

With section-header comments, headers are treated as fixed run boundaries. The
rule sorts members within each run but does not move members across runs. A
field/function class change also starts a new run. This preserves author
groupings even when the field classification would otherwise place a member in
a different canonical section.

A comment on its own line directly above a member moves with that member.
Floating or trailing comments prevent a needed reorder. If the interface is
already ordered, no diagnostic is emitted for those comments.

## XML Field Classification

Interface fields are classified as `event`, `property`, or `ambiguous`.

Config overrides win:

```json
{
  "xml": {
    "fieldClassificationOverrides": {
      "components/Foo.xml": {
        "dismissClicked": "event",
        "data": "property"
      }
    }
  }
}
```

Default classification:

- `is*`, `has*`, `can*`, and `should*` names are properties.
- Event fields require both an event-like name and evidence that the value is
  produced by the component.
- A final word carrying a tense suffix (`-ed`, `-ing`) is event-like unless it
  is in the non-verb denylist.
- `complete`, `ready`, and `done` count as event-like words.
- A field is event-backed when a linked script assigns `m.top.<fieldId>` or when
  the field has an `alias=` attribute. Tense/event-like fields without that
  backing are properties.
- Reads of `m.top.<fieldId>` indicate inbound property usage. Assignment
  statements indicate outbound production. Non-tensed names remain properties
  even when written.
- Standalone state participles such as `expanded`, `collapsed`, `checked`,
  `highlighted`, `hidden`, `pinned`, and `locked` are events when produced and
  unread, properties when not produced, and ambiguous if both read and written.
- `enabled`, `disabled`, `selected`, `focused`, and `unfocused` prefer property
  classification even when both read and written.
- Names with no event-like signal default to property.

An unresolved ambiguous field prevents interface reordering.

## XML onChange Convention

`onChange="..."` on `<field>` is discouraged. The rule emits a diagnostic that
recommends moving observation into `init()` with:

```brightscript
m.top.observeFieldScoped("<fieldId>", "_set<FieldIdAsPascalCase>")
```

In CLI project mode, when the XML file and target script are both part of the
same run, the tool can migrate safely:

- Remove the XML `onChange` attribute.
- Insert a missing `m.top.observeFieldScoped(...)` line at the start of `init`.
  If the target script has no `init`, create one at the top of the file.
- Rename the old handler routine, bare calls, and observer handler strings to
  the generated `_set<FieldId>` name when there is no collision and no existing
  observer for the field.
- Leave existing code observers and established handler names alone.

## Audit Conventions

- `audit/handler-intent` is currently a no-op compatibility rule.
- `audit/ui-node-prefix` expects component-local `findNode(...)` assignments to
  use `m._ui*` member names.
- Scripts linked from a component XML that extends `Scene`, and scene-level
  `findNode(...)` receivers, are exempt from the `_ui` rule.
- Animation and Interpolator node handles are exempt from `_ui`, but they still
  need a private `_` prefix.
- `audit/private-member-naming` expects private `m` members to be lowerCamelCase
  with an optional leading `_`.
- `_`-prefixed ALL_CAPS `m` members are accepted as constants. Unprefixed
  ALL_CAPS members are diagnosed as needing a leading `_`, not lower-casing.
- In project mode, routines declared in the component XML interface, including
  inherited interface functions from parent component XML files in the run, are
  public and should be unprefixed.
- In a primary component script, routines not declared in the XML interface are
  private and should be `_`-prefixed, except framework routines such as `init`
  and `onKeyEvent`.
- Same-directory component-local linked script routines are private unless they
  are declared in the XML interface, are framework routines, or use a namespaced
  global helper form such as `HTTPUtil_addQueryParams`.
- Scripts linked from outside the component directory are not forced private.
- Safe private routine fixes update declarations, bare calls, observer handler
  strings, and sibling-script call sites when no name collision exists.
- `_`-prefixed XML `<function name="...">` entries are reported but not
  auto-promoted to public names.
- `audit/hardcoded-string` flags direct non-empty string literals assigned to
  `.text`; use `ResourceUtil_getString(...)`.
- `audit/prefer-dreamsocket-utils` flags selected builtin calls and recommends
  Dreamsocket helper namespaces such as `StringUtil_*` and `TypeUtil_*`.

## Config Defaults

```json
{
  "include": ["**/*.{brs,bs,xml}"],
  "ignore": [
    "**/roku_modules/**",
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/out/**"
  ],
  "rules": {
    "brs/declaration-order": "error",
    "brs/declaration-spacing": "error",
    "brs/block-if-form": "error",
    "brs/if-condition-parens": "error",
    "xml/attribute-order": "error",
    "xml/script-order": "error",
    "xml/interface-section-order": "error",
    "xml/no-onchange-field": "warn",
    "audit/handler-intent": "warn",
    "audit/ui-node-prefix": "warn",
    "audit/private-member-naming": "warn",
    "audit/prefer-dreamsocket-utils": "off",
    "audit/hardcoded-string": "off"
  },
  "brs": {
    "blankLinesBetweenRoutines": 3
  },
  "xml": {
    "interfaceSectionComments": "preserve",
    "fieldClassificationOverrides": {}
  }
}
```

Config is discovered from `package.json`, `bsprettier.json`,
`bsprettier.config.json`, `.bsprettierrc.json`, or `.bsprettierrc`. Explicit
`--config` paths override discovery.

## Plan Sync Notes

`bsprettier-plan.md` has been updated to match the implementation details this
spec records. The plan still contains future release-hardening work, including a
full corpus fixture suite, CI matrix setup, and an optional BSC plugin, but those
items are now labelled as deferred or future work rather than current behavior.
