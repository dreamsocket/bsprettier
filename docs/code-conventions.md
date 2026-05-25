# bsprettier Code Conventions

This document describes the BrightScript, BrighterScript, and SceneGraph XML
formatting and code conventions enforced by the current `bsprettier`
implementation. The README covers installation, CLI usage, and project
workflows; this document is the rule and convention reference.

BrightScript examples use `vb` code fences because many Markdown renderers do
not ship a BrightScript grammar. Visual Basic highlighting is close enough for
keywords, strings, and single-quote comments while keeping examples readable.

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
- Suppressed files and lines are skipped before rule edits are applied. A
  whole-file suppression must be the first non-blank line. A next-line
  suppression can name specific rule ids or omit ids to suppress every rule on
  the following line:

```vb
' bsprettier-disable

' bsprettier-disable-next-line brs/if-condition-parens,audit/parameter-naming
if m.ready then doWork(title)
```

```xml
<!-- bsprettier-disable -->

<!-- bsprettier-disable-next-line xml/interface-section-order -->
<field id="title" type="string" />
```

Current custom rule phases:

| Phase | Rules |
|---|---|
| `0` | `audit/private-member-naming`, `xml/attribute-order` |
| `1` | `brs/declaration-order`, `xml/script-order` |
| `2` | `brs/declaration-spacing`, `xml/interface-section-order` |
| `3` | `brs/block-if-form`, `xml/no-onchange-field` diagnostics |
| `4` | `brs/if-condition-parens`, `audit/handler-intent`, `audit/parameter-naming`, `audit/ui-node-prefix`, `audit/hardcoded-string`, `audit/prefer-dreamsocket-utils`, XML interface-function naming diagnostics from `audit/private-member-naming` |

## External Tool Boundaries

`bsprettier` integrates
[`brighterscript-formatter`](https://github.com/rokucommunity/brighterscript-formatter)
internally for `.brs` and `.bs` files. It runs before custom rules to normalize
basic layout, spacing, casing, and indentation, then runs again after custom
rules to clean up layout drift from moved declarations. When `--rules` is used,
that formatter runs only if `brs/format-style` is included. `brs/format-style`
is an implicit formatter switch, not a configurable rule entry in the default
rule set.

| Concern | Integrated bsfmt | bslint | bsprettier AST rules |
|---|---|---|---|
| Indentation, keyword case, trailing whitespace | yes, pre/post | no | no |
| Import sorting (`.bs`) | yes, default `sortImports` | no | no |
| If condition parentheses presence | no | yes, `group`, also covers `while` | yes, simple same-line `if` / `else if` |
| Condition paren spacing `if(` | no | no | yes |
| Inline-if `then` presence | no | yes | no |
| Inline-if to block conversion | no | no | yes |
| Final newline | no | yes, `eol-last` | yes |
| Top-level routine cohort order | no | no | yes |
| Blank-line count between routines | no | no | yes |
| XML script/interface/attribute order | no | no | yes |
| `onChange` field avoidance | no | no | yes, diagnostic and project-mode migration |
| Private routine/member naming | no | no | yes |
| Parameter naming | no | no | yes |
| UI node handle naming | no | no | yes |
| Hardcoded `.text` strings and helper preference audits | no | no | yes, diagnostics only |

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

Pseudo example showing declaration cohorts and routine spacing:

```vb
' Before: cohorts are mixed and spacing is inconsistent.
function _onLoaded()
end function

function render()
end function

function onKeyEvent(key as string, press as boolean) as boolean
    return false
end function

sub _cacheResult()
end sub

sub init()
end sub

sub loadData()
end sub

sub _onFocused()
end sub
```

becomes:

```vb
' init always sorts first.
sub init()
end sub



' Public routines are unprefixed and sort ASCII-ascending.
sub loadData()
end sub



function render()
end function



' Private routines use a leading underscore and sort after public routines.
sub _cacheResult()
end sub



' _on* routines are observers and sort ASCII-ascending within that cohort.
sub _onFocused()
end sub



' onKeyEvent is an observer and sorts as the virtual name _onKeyEvent.
function onKeyEvent(key as string, press as boolean) as boolean
    return false
end function



function _onLoaded()
end function
```

## BRS/BS Inline If Form

Single-line inline `if` statements are converted to block form only when all of
these are true:

- The node is an inline `if`.
- There is exactly one consequent statement.
- There is no `else` or `else if`.
- The condition and consequent statement are both single-line.
- There is no trailing same-line text or comment after the consequent.
- The file indentation unit can be detected.

The conversion preserves the condition text byte-for-byte. Parentheses are added
or spacing-normalized later by the if-condition parentheses rule.

Example:

```vb
if (m.ready) then m.count = 1
```

becomes:

```vb
if (m.ready)
    m.count = 1
end if
```

## BRS/BS If Condition Parentheses

Simple same-line `if` and `else if` conditions are wrapped in parentheses, and
whitespace between the `if` token and the opening parenthesis is removed:

```vb
if m.ready
    start()
else if m.failed
    stop()
end if
```

becomes:

```vb
if(m.ready)
    start()
else if(m.failed)
    stop()
end if
```

Already-parenthesized conditions keep their existing condition text, with only
the keyword-to-paren spacing normalized. Multi-line conditions are left
unchanged and emit an informational diagnostic. Comments between `if` and the
condition or `(` prevent the edit.

## XML Attribute Order

Attributes are reordered within the original attribute block while preserving
quote style and inter-attribute whitespace:

- `<component>` and `<function>` pin `name` first.
- All other elements pin `id` first when present.
- Remaining attributes sort ASCII-ascending, case-sensitive.

Pseudo example:

```xml
<!-- Before: id/name are not pinned, and remaining attributes are unsorted. -->
<field type="string" alwaysNotify="true" id="title" />

<function params="value" name="setTitle" />
```

becomes:

```xml
<field id="title" alwaysNotify="true" type="string" />

<function name="setTitle" params="value" />
```

## XML Script Order

`<script>` siblings under the root `<component>` are reordered only when all
script elements form one contiguous sibling run. If a non-script child sits
between script elements, the rule emits a diagnostic and leaves them unchanged.

Ordering rules:

- The direct component script sorts first. It must be a current-directory URI
  whose basename matches the XML filename, for example `Widget.brs` beside
  `Widget.xml`.
- Remaining current-directory scripts sort next, ASCII-ascending by full `uri`.
- A blank line separates current-directory scripts from `pkg:` scripts.
- All `pkg:` scripts sort after current-directory scripts, ASCII-ascending by
  full `uri`.
- A blank line separates `pkg:/source/...` scripts from other `pkg:` scripts
  when those spacing groups meet.
- Any remaining path or protocol scripts sort after `pkg:` scripts,
  ASCII-ascending by full `uri`, separated from `pkg:` scripts by a blank line.
- A comment on its own line directly above a script moves with that script.
- Floating comments, trailing same-line comments, and section-header comments
  make the reorder unsafe and prevent the edit.

Pseudo example for `Widget.xml`:

```xml
<!-- Before: current-directory, pkg, and source scripts are mixed. -->
<script uri="pkg:/source/Analytics.brs" />
<script uri="pkg:/components/shared/Strings.brs" />
<script uri="lib:/external/Tracker.brs" />
<script uri="Helpers.brs" />
<script uri="Widget.brs" />
```

becomes:

```xml
<script uri="Widget.brs" />
<script uri="Helpers.brs" />

<script uri="pkg:/components/shared/Strings.brs" />

<script uri="pkg:/source/Analytics.brs" />

<script uri="lib:/external/Tracker.brs" />
```

## XML Interface Order

Inside `<interface>`, children must be only `<field>` or `<function>` elements.
Any other child element prevents reordering.

Without section headers, members are gathered and sorted as:

1. Event fields, sorted by `id`
2. Property fields, sorted by `id`
3. Functions, sorted by `name`

The rule inserts one blank line between those section groups and keeps members
within the same group packed together.

With section-header comments, headers are treated as fixed run boundaries. The
rule sorts members within each run but does not move members across runs. A
transition between `<field>` and `<function>` members also starts a new run.
This preserves author groupings even when the field classification would
otherwise place a member in a different canonical section.

A comment on its own line directly above a member moves with that member.
Floating or trailing comments prevent a needed reorder. If the interface is
already ordered, no diagnostic is emitted for those comments.

Pseudo example without section headers:

```xml
<!-- Before: properties, functions, and event fields are mixed. -->
<interface>
    <function name="reset" />
    <field id="title" type="string" />
    <field id="dismissed" type="boolean" alias="state.dismissed" />
    <field id="count" type="integer" />
</interface>
```

becomes:

```xml
<interface>
    <field id="dismissed" alias="state.dismissed" type="boolean" />

    <field id="count" type="integer" />
    <field id="title" type="string" />

    <function name="reset" />
</interface>
```

Pseudo example with section-header comments:

```xml
<interface>
    <!-- Properties -->
    <field id="title" type="string" />
    <field id="count" type="integer" />

    <!-- Actions -->
    <function name="refresh" />
    <function name="close" />
</interface>
```

becomes:

```xml
<interface>
    <!-- Properties -->
    <field id="count" type="integer" />
    <field id="title" type="string" />

    <!-- Actions -->
    <function name="close" />
    <function name="refresh" />
</interface>
```

The headers stay in place and define fixed runs. The rule sorts inside each run
but does not move fields or functions across those author-defined boundaries.

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
  statements at the start of a line indicate outbound production. Compound
  assignments such as `+=` count as both read and write. `observeField(...)` and
  `observeFieldScoped(...)` on the same field count as reads. Comparisons,
  associative-array values, and other references are reads, not writes.
  Non-tensed names remain properties even when written.
- Standalone state participles such as `expanded`, `collapsed`, `checked`,
  `unchecked`, `highlighted`, `hidden`, `pinned`, `locked`, and `unlocked` are
  events when produced and unread, properties when not produced, and ambiguous
  if both read and written.
- `enabled`, `disabled`, `selected`, `focused`, and `unfocused` prefer property
  classification even when both read and written.
- Names with no event-like signal default to property.

An unresolved ambiguous field prevents interface reordering.

Pseudo example:

```xml
<interface>
    <field id="dismissed" alias="state.dismissed" type="boolean" />  <!-- event-backed, event-like name -->

    <field id="expanded" type="boolean" />  <!-- state participle without production evidence -->
    <field id="title" type="string" />      <!-- ordinary property name -->
</interface>
```

Backing and usage evidence classify those fields. A separate state field that is
both produced and read remains ambiguous:

```vb
sub close()
    m.top.dismissed = true ' produced and event-like, so classified as event
end sub

sub render()
    title = m.top.title ' read usage keeps this classified as property
end sub

sub toggle()
    m.top.checked = true  ' produced state participle
    state = m.top.checked ' read plus write makes this ambiguous
end sub
```

## XML onChange Convention

`onChange="..."` on `<field>` is discouraged. The rule emits a diagnostic that
recommends moving observation into `init()` with:

```vb
m.top.observeFieldScoped("<fieldId>", "_set<FieldIdAsPascalCase>")
```

In CLI project mode, when the XML file and target script are both part of the
same run, the tool can migrate safely:

- Remove the XML `onChange` attribute.
- Choose the target script from linked scripts by matching the XML basename,
  falling back to the only linked script, then to a sibling `<XmlName>.brs`.
- Insert a missing `m.top.observeFieldScoped(...)` line at the start of `init`.
  If the target script has no `init`, create one at the top of the file.
- Rename the old handler routine, bare calls, and observer handler strings to
  the generated `_set<FieldId>` name when there is no collision and no existing
  observer for the field.
- Leave existing code observers and established handler names alone.

Pseudo migration:

```xml
<!-- Before -->
<field id="title" type="string" onChange="_onTitleChanged" />
```

```vb
sub init()
    _onTitleChanged()
end sub

sub _onTitleChanged()
end sub
```

becomes:

```xml
<field id="title" type="string" />
```

```vb
sub init()
    m.top.observeFieldScoped("title", "_setTitle")
    _setTitle()
end sub

sub _setTitle()
end sub
```

## Audit Conventions

- `audit/handler-intent` is currently a no-op compatibility rule.
- `audit/parameter-naming` expects routine parameters to use the `p_` prefix.
  Safe fixes update the declaration and references inside the routine, but leave
  associative-array keys, dotted member names, and nested function bodies alone.
- `audit/ui-node-prefix` expects component-local `findNode(...)` assignments to
  use `m._ui*` member names.
- Scripts linked from a component XML that extends `Scene`, and scene-level
  `findNode(...)` receivers, are exempt from the `_ui` rule. Scene-level
  receivers include direct scene objects and local variables assigned from
  `getScene()`.
- Animation and Interpolator node handles are exempt from `_ui`, but they still
  need a private `_` prefix. Animation and Interpolator ids are read from XML
  elements whose tag names end in `Animation` or `Interpolator`.
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
- `audit/hardcoded-string` flags direct non-empty double-quoted string literals
  assigned to `.text`; use `ResourceUtil_getString(...)`.
- `audit/prefer-dreamsocket-utils` flags `UCase(...)`, `LCase(...)`,
  `Mid(...)`, `Instr(...)`, and `Type(...)`, recommending Dreamsocket helper
  namespaces such as `StringUtil_*` and `TypeUtil_*`.

Pseudo routine visibility and member naming example:

```xml
<interface>
    <function name="setTitle" />
    <function name="_legacyPrivate" /> <!-- reported: interface functions are public -->
</interface>
```

```vb
sub init() ' framework routine, never forced private.
    m.top.observeFieldScoped("title", "_setTitle")
end sub



function HTTPUtil_addQueryParams(p_url as string) as string
    ' Namespaced global helper form is exempt from component-private prefixing.
    return p_url
end function



sub setTitle(p_title as string) ' XML interface routine stays public.
    m._lastTitle = p_title      ' private member is lowerCamelCase.
    m._TITLE_KEY = "home.title" ' private constant may be _ALL_CAPS.
    m._uiTitle.text = ResourceUtil_getString(m._TITLE_KEY)
end sub



sub _renderCount(p_count as integer) ' non-interface component routine is private.
    text = StringUtil_toString(p_count)
end sub



function onKeyEvent(key as string, press as boolean) as boolean
    ' Framework observer, never forced private.
    return false
end function
```

Pseudo private routine rename:

```vb
' Before: renderCount is not declared in the XML interface.
sub init()
    m.top.observeFieldScoped("count", "renderCount")
    renderCount()
end sub

sub renderCount()
end sub
```

becomes:

```vb
sub init()
    m.top.observeFieldScoped("count", "_renderCount")
    _renderCount()
end sub



sub _renderCount()
end sub
```

Pseudo private member rename:

```vb
' Before: assigned m members start with uppercase letters.
m.Title = p_title
m.TITLE_KEY = "home.title"
```

becomes:

```vb
m._title = p_title
m._TITLE_KEY = "home.title"
```

Pseudo parameter rename:

```vb
' Before: parameters lack p_ prefixes.
sub _renderItem(title as string, Count as integer)
    label = title
    meta = { title: title } ' associative-array key stays "title".
    node.title = title      ' dotted member name stays "title".
end sub
```

becomes:

```vb
sub _renderItem(p_title as string, p_count as integer)
    label = p_title
    meta = { title: p_title }
    node.title = p_title
end sub
```

Pseudo UI node handle example:

```xml
<children>
    <Label id="titleLabel" />
    <Animation id="fadeAnimation" />
</children>
```

```vb
' Before: component-local findNode handles are not prefixed.
sub init()
    m.titleLabel = m.top.findNode("titleLabel")
    m.fadeAnimation = m.top.findNode("fadeAnimation")
end sub
```

becomes:

```vb
sub init()
    m._uiTitleLabel = m.top.findNode("titleLabel") ' component-local UI node.
    m._fadeAnimation = m.top.findNode("fadeAnimation") ' Animation: private only.

    scene = m.top.getScene()
    m.globalButton = scene.findNode("globalButton") ' scene-level lookup exempt.
end sub
```

Pseudo hardcoded string and utility preference example:

```vb
' Reported by audit/hardcoded-string.
m._uiTitle.text = "Play"

' Preferred.
m._uiTitle.text = ResourceUtil_getString("play.button")

' Reported by audit/prefer-dreamsocket-utils.
normalized = UCase(p_title)
kind = Type(value)

' Preferred helper namespaces.
normalized = StringUtil_trim(p_title) ' choose the appropriate StringUtil_* helper.
isString = TypeUtil_isString(value)   ' choose the appropriate TypeUtil_* helper.
```

## Default Rule Set

```json
{
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
    "audit/parameter-naming": "warn",
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
