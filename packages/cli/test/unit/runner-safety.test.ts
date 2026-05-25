import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config.js";
import { formatFile } from "../../src/edit/runner.js";

const config = defaultConfig();

describe("runner safety", () => {
  it("leaves a file with parse errors untouched", () => {
    const src = "sub foo(\nend sub\n";
    const result = formatFile({ filePath: "Broken.brs", source: src, config });
    expect(result.status).toBe("parse-error");
    expect(result.output).toBe(src);
    expect(result.changed).toBe(false);
  });

  it("honors a whole-file disable comment", () => {
    const src = "' bsprettier-disable\nfunction zzz()\nend function\n\nsub init()\nend sub\n";
    const result = formatFile({ filePath: "Disabled.brs", source: src, config });
    expect(result.changed).toBe(false);
    expect(result.output).toBe(src);
  });

  it("honors a rule-specific BrightScript disable-next-line comment", () => {
    const src =
      "sub init()\n" +
      "    ' bsprettier-disable-next-line brs/block-if-form\n" +
      "    if (m.x) then m.y = 1\n" +
      "    if (m.z) then m.y = 2\n" +
      "end sub\n";
    const result = formatFile({ filePath: "DisabledNext.brs", source: src, config });

    expect(result.output).toContain("    if(m.x) then m.y = 1");
    expect(result.output).toContain("    if(m.z)\n        m.y = 2\n    end if");
  });

  it("honors an XML disable-next-line comment", () => {
    const src =
      '<component name="W" extends="Group">\n' +
      "  <interface>\n" +
      "    <!-- bsprettier-disable-next-line xml/no-onchange-field -->\n" +
      '    <field id="focusedChild" type="node" onChange="_focusNav" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const result = formatFile({
      filePath: "W.xml",
      source: src,
      config,
      onlyRules: new Set(["xml/no-onchange-field"]),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it("respects --rules style restriction via onlyRules", () => {
    const src = "sub init()\n    if (m.x) then m.y = 1\nend sub\n";
    const result = formatFile({
      filePath: "Sel.brs",
      source: src,
      config,
      onlyRules: new Set(["brs/if-condition-parens"]),
    });
    // block-if-form is excluded, so the inline-if stays inline; only the
    // keyword/paren spacing is normalized.
    expect(result.output).toContain("if(m.x) then");
    expect(result.output).not.toContain("end if");
  });

  it("adds missing parentheses to simple if and else if conditions", () => {
    const src =
      "sub init()\n" +
      "    if m.x then\n" +
      "        m.y = 1\n" +
      "    else if not m.z then\n" +
      "        m.y = 2\n" +
      "    end if\n" +
      "end sub\n";
    const result = formatFile({
      filePath: "MissingParens.brs",
      source: src,
      config,
      onlyRules: new Set(["brs/if-condition-parens"]),
    });

    expect(result.output).toContain("if(m.x) then");
    expect(result.output).toContain("else if(not m.z) then");
    expect(result.diagnostics).toEqual([]);
  });

  it("wraps the whole unparenthesized condition expression", () => {
    const src =
      "sub init()\n" +
      "    if m.x = true and not m.z then\n" +
      "        m.y = 1\n" +
      "    end if\n" +
      "end sub\n";
    const result = formatFile({
      filePath: "CompoundCondition.brs",
      source: src,
      config,
      onlyRules: new Set(["brs/if-condition-parens"]),
    });

    expect(result.output).toContain("if(m.x = true and not m.z) then");
    expect(result.output).not.toContain("if((m.x = true and not m.z))");
    expect(result.diagnostics).toEqual([]);
  });

  it("does not double-wrap already-parenthesized conditions", () => {
    const src = "sub init()\n    if (m.x) then m.y = 1\nend sub\n";
    const result = formatFile({
      filePath: "AlreadyGrouped.brs",
      source: src,
      config,
      onlyRules: new Set(["brs/if-condition-parens"]),
    });

    expect(result.output).toContain("if(m.x) then");
    expect(result.output).not.toContain("if((m.x)) then");
    expect(result.diagnostics).toEqual([]);
  });

  it("adds missing parentheses to inline ifs when only condition formatting is selected", () => {
    const src = "sub init()\n    if m.x then m.y = 1\nend sub\n";
    const result = formatFile({
      filePath: "InlineOnlyMissingParens.brs",
      source: src,
      config,
      onlyRules: new Set(["brs/if-condition-parens"]),
    });

    expect(result.output).toContain("if(m.x) then m.y = 1");
    expect(result.output).not.toContain("end if");
    expect(result.diagnostics).toEqual([]);
  });

  it("adds missing parentheses after inline if conversion", () => {
    const src = "sub init()\n    if m.x then m.y = 1\nend sub\n";
    const result = formatFile({
      filePath: "InlineMissingParens.brs",
      source: src,
      config,
    });

    expect(result.output).toContain("    if(m.x)\n        m.y = 1\n    end if");
    expect(result.diagnostics).toEqual([]);
  });

  it("does not run brighterscript-formatter unless brs/format-style is selected", () => {
    const src = "SUB init()\n    if (m.x) then m.y = 1\nEND SUB\n";
    const result = formatFile({
      filePath: "Selected.brs",
      source: src,
      config,
      onlyRules: new Set(["brs/if-condition-parens"]),
    });

    expect(result.ruleIds).not.toContain("brs/format-style");
    expect(result.output).toContain("SUB init()");
    expect(result.output).toContain("if(m.x) then");
    expect(result.output).toContain("END SUB");
  });

  it("runs only brs/format-style when selected explicitly", () => {
    const src = "SUB init()\n    if (m.x) then m.y = 1\nEND SUB\n";
    const result = formatFile({
      filePath: "Selected.brs",
      source: src,
      config,
      onlyRules: new Set(["brs/format-style"]),
    });

    expect(result.ruleIds).toEqual(["brs/format-style"]);
    expect(result.output).toContain("sub init()");
    expect(result.output).toContain("if (m.x) then m.y = 1");
    expect(result.output).not.toContain("end if");
  });

  it("is idempotent on already-formatted output", () => {
    const src = "function _onX()\nend function\n\nsub init()\nend sub\n";
    const once = formatFile({ filePath: "I.brs", source: src, config }).output;
    const twice = formatFile({ filePath: "I.brs", source: once, config }).output;
    expect(twice).toBe(once);
  });

  it("does not rewrite an inline if with a trailing same-line comment", () => {
    const src = "sub init()\n    if (m.x) then m.y = 1 ' keep me\nend sub\n";
    const result = formatFile({ filePath: "Tc.brs", source: src, config });
    expect(result.output).toContain("' keep me");
    expect(result.output).not.toContain("end if");
    expect(result.diagnostics.some((d) => d.ruleId === "brs/block-if-form")).toBe(
      true,
    );
  });

  it("refuses declaration reordering when routines are interleaved with other top-level declarations", () => {
    const src =
      "sub zzz()\n" +
      "end sub\n\n" +
      "namespace Example\n" +
      "end namespace\n\n" +
      "sub init()\n" +
      "end sub\n";
    const result = formatFile({
      filePath: "Interleaved.bs",
      source: src,
      config,
      onlyRules: new Set(["brs/declaration-order"]),
    });

    expect(result.changed).toBe(false);
    expect(result.output).toBe(src);
    expect(result.diagnostics[0]?.message).toContain("interleaved");
  });

  it("refuses declaration reordering when multiple init routines exist", () => {
    const src =
      "sub zzz()\n" +
      "end sub\n\n" +
      "sub init()\n" +
      "end sub\n\n" +
      "sub init()\n" +
      "end sub\n";
    const result = formatFile({
      filePath: "MultipleInit.brs",
      source: src,
      config,
      onlyRules: new Set(["brs/declaration-order"]),
    });

    expect(result.changed).toBe(false);
    expect(result.output).toBe(src);
    expect(result.diagnostics[0]?.message).toContain("Multiple init");
  });

  it("does not reorder interface members when comments sit between them", () => {
    const src =
      '<component name="W" extends="Group">\n' +
      "  <interface>\n" +
      '    <!-- z field --><field id="z" type="string" />\n' +
      '    <!-- a field --><field id="a" type="string" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const result = formatFile({ filePath: "W.xml", source: src, config });
    expect(result.changed).toBe(false);
    expect(
      result.diagnostics.some((d) => d.ruleId === "xml/interface-section-order"),
    ).toBe(true);
  });

  it("does not reorder scripts when comments sit between them", () => {
    const src =
      '<component name="W" extends="Group">\n' +
      '  <!-- z --><script type="text/brightscript" uri="pkg:/z.brs" />\n' +
      '  <!-- a --><script type="text/brightscript" uri="pkg:/a.brs" />\n' +
      "</component>\n";
    const result = formatFile({ filePath: "W.xml", source: src, config });
    expect(result.changed).toBe(false);
    expect(
      result.diagnostics.some((d) => d.ruleId === "xml/script-order"),
    ).toBe(true);
  });

  it("reorders interface members and carries an own-line leading comment", () => {
    const src =
      '<component name="W" extends="Group">\n' +
      "  <interface>\n" +
      "    <!-- z field -->\n" +
      '    <field id="z" type="string" />\n' +
      '    <field id="a" type="string" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const result = formatFile({ filePath: "W.xml", source: src, config });
    expect(result.changed).toBe(true);
    expect(
      result.diagnostics.some((d) => d.ruleId === "xml/interface-section-order"),
    ).toBe(false);
    // a sorts first; the "z field" comment travels with field z.
    const a = result.output.indexOf('id="a"');
    const comment = result.output.indexOf("<!-- z field -->");
    const z = result.output.indexOf('id="z"');
    expect(a).toBeLessThan(comment);
    expect(comment).toBeLessThan(z);
  });

  it("reorders scripts and carries an own-line leading comment", () => {
    const src =
      '<component name="W" extends="Group">\n' +
      "  <!-- z -->\n" +
      '  <script type="text/brightscript" uri="pkg:/z.brs" />\n' +
      '  <script type="text/brightscript" uri="pkg:/a.brs" />\n' +
      "</component>\n";
    const result = formatFile({ filePath: "W.xml", source: src, config });
    expect(result.changed).toBe(true);
    expect(
      result.diagnostics.some((d) => d.ruleId === "xml/script-order"),
    ).toBe(false);
    // a.brs sorts first; the "z" comment travels with z.brs.
    const a = result.output.indexOf("a.brs");
    const comment = result.output.indexOf("<!-- z -->");
    const z = result.output.indexOf("z.brs");
    expect(a).toBeLessThan(comment);
    expect(comment).toBeLessThan(z);
  });

  it("groups script imports with blank lines between local, pkg, and source scripts", () => {
    const src =
      '<component name="LaunchDarkly" extends="Group">\n' +
      '  <script type="text/brightscript" uri="pkg:/components/launchdarkly/LaunchDarkly.brs" />\n' +
      '  <script type="text/brightscript" uri="ZLocal.brs" />\n' +
      '  <script type="text/brightscript" uri="LaunchDarkly.brs" />\n' +
      '  <script type="text/brightscript" uri="pkg:/source/ahelper.brs" />\n' +
      '  <script type="text/brightscript" uri="ALocal.brs" />\n' +
      "</component>\n";
    const result = formatFile({
      filePath: "components/services/LaunchDarkly/LaunchDarkly.xml",
      source: src,
      config,
    });
    expect(result.changed).toBe(true);
    expect(
      result.diagnostics.some((d) => d.ruleId === "xml/script-order"),
    ).toBe(false);
    expect(result.output).toBe(
      '<component name="LaunchDarkly" extends="Group">\n' +
        '  <script type="text/brightscript" uri="LaunchDarkly.brs" />\n' +
        '  <script type="text/brightscript" uri="ALocal.brs" />\n' +
        '  <script type="text/brightscript" uri="ZLocal.brs" />\n' +
        "\n" +
        '  <script type="text/brightscript" uri="pkg:/components/launchdarkly/LaunchDarkly.brs" />\n' +
        "\n" +
        '  <script type="text/brightscript" uri="pkg:/source/ahelper.brs" />\n' +
        "</component>\n",
    );
  });

  it("adds script group blank lines when ordering is already correct", () => {
    const src =
      '<component name="Widget" extends="Group">\n' +
      '  <script type="text/brightscript" uri="Widget.brs" />\n' +
      '  <script type="text/brightscript" uri="WidgetHelpers.brs" />\n' +
      '  <script type="text/brightscript" uri="pkg:/components/common/Utils.brs" />\n' +
      '  <script type="text/brightscript" uri="pkg:/source/device.brs" />\n' +
      "</component>\n";
    const result = formatFile({
      filePath: "components/Widget.xml",
      source: src,
      config,
    });
    expect(result.output).toBe(
      '<component name="Widget" extends="Group">\n' +
        '  <script type="text/brightscript" uri="Widget.brs" />\n' +
        '  <script type="text/brightscript" uri="WidgetHelpers.brs" />\n' +
        "\n" +
        '  <script type="text/brightscript" uri="pkg:/components/common/Utils.brs" />\n' +
        "\n" +
        '  <script type="text/brightscript" uri="pkg:/source/device.brs" />\n' +
        "</component>\n",
    );
  });

  it("sorts within a labelled section and keeps the section header anchored", () => {
    const src =
      '<component name="W" extends="Group">\n' +
      "  <interface>\n" +
      "    <!-- PROPERTIES -->\n" +
      '    <field id="z" type="string" />\n' +
      '    <field id="a" type="string" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const result = formatFile({ filePath: "W.xml", source: src, config });
    expect(result.changed).toBe(true);
    expect(
      result.diagnostics.some((d) => d.ruleId === "xml/interface-section-order"),
    ).toBe(false);
    // The PROPERTIES header stays first; fields sort a, z under it.
    const header = result.output.indexOf("<!-- PROPERTIES -->");
    const a = result.output.indexOf('id="a"');
    const z = result.output.indexOf('id="z"');
    expect(header).toBeLessThan(a);
    expect(a).toBeLessThan(z);
  });

  it("respects author sub-groupings under separate section headers", () => {
    // getters and functions are both Functions; each stays its own sorted block.
    const src =
      '<component name="W" extends="Group">\n' +
      "  <interface>\n" +
      "    <!-- getters -->\n" +
      '    <function name="getB" />\n' +
      '    <function name="getA" />\n' +
      "    <!-- functions -->\n" +
      '    <function name="doB" />\n' +
      '    <function name="doA" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const result = formatFile({ filePath: "W.xml", source: src, config });
    expect(result.changed).toBe(true);
    const getters = result.output.indexOf("<!-- getters -->");
    const getA = result.output.indexOf('name="getA"');
    const getB = result.output.indexOf('name="getB"');
    const functions = result.output.indexOf("<!-- functions -->");
    const doA = result.output.indexOf('name="doA"');
    const doB = result.output.indexOf('name="doB"');
    // Each block sorts internally; getters block stays before functions block.
    expect(getters).toBeLessThan(getA);
    expect(getA).toBeLessThan(getB);
    expect(getB).toBeLessThan(functions);
    expect(functions).toBeLessThan(doA);
    expect(doA).toBeLessThan(doB);
  });

  it("sorts within an author-labelled section even when classification disagrees", () => {
    // `loaded` classifies as an event, but the author grouped it under
    // PROPERTIES. We trust the grouping: both <field>s stay in the one run and
    // sort alphabetically under the anchored header — no cross-section move and
    // no refusal.
    const src =
      '<component name="W" extends="Group">\n' +
      "  <interface>\n" +
      "    <!-- PROPERTIES -->\n" +
      '    <field id="loaded" type="boolean" />\n' +
      '    <field id="config" type="assocarray" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const result = formatFile({ filePath: "W.xml", source: src, config });
    expect(result.changed).toBe(true);
    expect(
      result.diagnostics.some((d) => d.ruleId === "xml/interface-section-order"),
    ).toBe(false);
    // Header stays first; fields sort config, loaded under it.
    const header = result.output.indexOf("<!-- PROPERTIES -->");
    const cfg = result.output.indexOf('id="config"');
    const loaded = result.output.indexOf('id="loaded"');
    expect(header).toBeLessThan(cfg);
    expect(cfg).toBeLessThan(loaded);
  });

  it("uses configured XML field classification overrides", () => {
    const baseConfig = defaultConfig();
    const overrideConfig = {
      ...baseConfig,
      xml: {
        ...baseConfig.xml,
        fieldClassificationOverrides: {
          "components/Foo.xml": {
            dismissed: "property" as const,
          },
        },
      },
    };
    const src =
      '<component name="Foo" extends="Group">\n' +
      "  <interface>\n" +
      '    <field id="title" type="string" />\n' +
      '    <field id="dismissed" type="boolean" />\n' +
      "  </interface>\n" +
      "</component>\n";

    const result = formatFile({
      filePath: "components/Foo.xml",
      source: src,
      config: overrideConfig,
      onlyRules: new Set(["xml/interface-section-order"]),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.output.indexOf('id="dismissed"')).toBeLessThan(
      result.output.indexOf('id="title"'),
    );
  });

  it("does not flag private helpers unless they are m.top observer callbacks", () => {
    const src =
      "sub init()\n" +
      "    _cancelJob()\n" +
      "end sub\n\n" +
      "sub _cancelJob()\n" +
      "end sub\n";
    const result = formatFile({
      filePath: "Helpers.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/handler-intent"]),
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("does not force existing m.top observers to use _set property names", () => {
    const src =
      "sub init()\n" +
      '    m.top.observeFieldScoped("focusedChild", "_focusNav")\n' +
      "end sub\n\n" +
      "sub _focusNav()\n" +
      "end sub\n";
    const result = formatFile({
      filePath: "Observer.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/handler-intent"]),
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain(
      '    m.top.observeFieldScoped("focusedChild", "_focusNav")',
    );
    expect(result.output).toContain("sub _focusNav()");
  });

  it("reports direct user-facing string assignments when the audit rule is enabled", () => {
    const src =
      "sub init()\n" +
      '    m._uiTitle.text = "Play"\n' +
      "end sub\n";
    const auditConfig = {
      ...config,
      rules: { ...config.rules, "audit/hardcoded-string": "warn" as const },
    };
    const result = formatFile({
      filePath: "Strings.brs",
      source: src,
      config: auditConfig,
      onlyRules: new Set(["audit/hardcoded-string"]),
    });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain("ResourceUtil_getString");
  });

  it("reports builtin calls when the Dreamsocket utility audit rule is enabled", () => {
    const src =
      "sub init()\n" +
      '    upper = UCase("title")\n' +
      "    kind = Type(m.top)\n" +
      "end sub\n";
    const auditConfig = {
      ...config,
      rules: {
        ...config.rules,
        "audit/prefer-dreamsocket-utils": "warn" as const,
      },
    };
    const result = formatFile({
      filePath: "Utils.brs",
      source: src,
      config: auditConfig,
      onlyRules: new Set(["audit/prefer-dreamsocket-utils"]),
    });

    expect(result.diagnostics.map((d) => d.message).join("\n")).toContain(
      "StringUtil_*",
    );
    expect(result.diagnostics.map((d) => d.message).join("\n")).toContain(
      "TypeUtil_*",
    );
  });

  it("renames parameters to p_ and updates routine-local references", () => {
    const src =
      "function render(item as object, count as integer) as object\n" +
      "    item = item\n" +
      "    result = { item: item, count: count }\n" +
      "    m.item = item\n" +
      "    item.title = count\n" +
      "    return item\n" +
      "end function\n";
    const result = formatFile({
      filePath: "Params.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/parameter-naming"]),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.output).toBe(
      "function render(p_item as object, p_count as integer) as object\n" +
        "    p_item = p_item\n" +
        "    result = { item: p_item, count: p_count }\n" +
        "    m.item = p_item\n" +
        "    p_item.title = p_count\n" +
        "    return p_item\n" +
        "end function\n",
    );
  });

  it("renames parameters in conditions after inline if conversion", () => {
    const src =
      "function pick(item as object) as object\n" +
      "    if item <> invalid then return item\n" +
      "    return invalid\n" +
      "end function\n";
    const result = formatFile({
      filePath: "ParamInlineIf.brs",
      source: src,
      config,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain(
      "    if(p_item <> invalid)\n        return p_item\n    end if",
    );
  });

  it("accepts parameters that already use p_", () => {
    const src =
      "sub show(p_item as object)\n" +
      "    print p_item\n" +
      "end sub\n";
    const result = formatFile({
      filePath: "Params.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/parameter-naming"]),
    });

    expect(result.changed).toBe(false);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not rename a parameter when the p_ target already exists", () => {
    const src =
      "sub show(item as object, p_item as object)\n" +
      "    print item\n" +
      "end sub\n";
    const result = formatFile({
      filePath: "Params.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/parameter-naming"]),
    });

    expect(result.changed).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.fixable).toBe(false);
    expect(result.diagnostics[0]!.message).toContain("already exists");
  });

  it("accepts _set prefixes for m.top observeField callbacks", () => {
    const src =
      "sub init()\n" +
      '    m.top.observeField("focusedChild", "_setFocusedChild")\n' +
      "end sub\n\n" +
      "sub _setFocusedChild()\n" +
      "end sub\n";
    const result = formatFile({
      filePath: "Observer.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/handler-intent"]),
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("does not force existing non-top observers to use _on property names", () => {
    const src =
      "sub init()\n" +
      '    m.child.observeFieldScoped("focusedChild", "_focusNav")\n' +
      "end sub\n\n" +
      "sub _focusNav()\n" +
      "end sub\n";
    const result = formatFile({
      filePath: "Observer.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/handler-intent"]),
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain(
      '    m.child.observeFieldScoped("focusedChild", "_focusNav")',
    );
    expect(result.output).toContain("sub _focusNav()");
  });

  it("treats _-prefixed ALL_CAPS member assignments as constants", () => {
    const src =
      "sub init()\n" +
      '    m._REGEX_FOLLOWED_BY_SLASH = CreateObject("roRegex", "/$", "")\n' +
      "    m.TILE_OFFSET = 1\n" +
      '    m._SFVodOlyEndLabel = "End"\n' +
      "    print m.TILE_OFFSET\n" +
      "    print m._SFVodOlyEndLabel\n" +
      "end sub\n";
    const result = formatFile({
      filePath: "Constants.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/private-member-naming"]),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain("    m._TILE_OFFSET = 1");
    expect(result.output).toContain("    print m._TILE_OFFSET");
    expect(result.output).toContain('    m._sfVodOlyEndLabel = "End"');
    expect(result.output).toContain("    print m._sfVodOlyEndLabel");
  });

  it("renames upper-camel member assignments across all m references", () => {
    const src =
      "sub init()\n" +
      "    m.top.RemoveChild(m.BrightLineDirect)\n" +
      "    m.BrightLineDirect = invalid\n" +
      "    m.BrightLineDirect = CreateObject(\"roSGNode\", \"BrightLineDirect:BL_init\")\n" +
      "    m.BrightLineDirect.ObserveField(\"state\", \"BrightLine_OnStateChange\")\n" +
      "end sub\n";
    const result = formatFile({
      filePath: "BrightLine.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/private-member-naming"]),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain("m.top.RemoveChild(m._brightLineDirect)");
    expect(result.output).toContain("    m._brightLineDirect = invalid");
    expect(result.output).toContain(
      "    m._brightLineDirect.ObserveField",
    );
    expect(result.output).not.toContain("m.BrightLineDirect");
  });

  it("does not surface private member diagnostics when a later _ui rewrite handles the member", () => {
    const xmlPath = "components/Player.xml";
    const brsPath = "components/Player.brs";
    const xml =
      '<component name="Player" extends="Group">\n' +
      '  <script type="text/brightscript" uri="Player.brs" />\n' +
      "</component>\n";
    const brs =
      "sub init()\n" +
      '    m._SFVodOlyEndLabel = m.top.findNode("SFVodOlyEndLabel")\n' +
      '    m._SFVodOlyEndLabel.labelText = "Done"\n' +
      "end sub\n";
    const result = formatFile({
      filePath: brsPath,
      source: brs,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain(
      '    m._uiSfVodOlyEndLabel = m.top.findNode("SFVodOlyEndLabel")',
    );
    expect(result.output).toContain(
      '    m._uiSfVodOlyEndLabel.labelText = "Done"',
    );
  });

  it("allows standalone utility functions to remain public", () => {
    const src =
      "function HTTPUtil_addQueryParams(url as string) as string\n" +
      "    return url\n" +
      "end function\n";
    const result = formatFile({
      filePath: "source/HTTPUtil.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/private-member-naming"]),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain("function HTTPUtil_addQueryParams(");
  });

  it("accepts _on prefixes for observers on member objects", () => {
    const src =
      "sub init()\n" +
      '    m._timer.observeFieldScoped("fired", "_onTimerFired")\n' +
      "end sub\n\n" +
      "sub _onTimerFired()\n" +
      "end sub\n";
    const result = formatFile({
      filePath: "Observer.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/handler-intent"]),
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("renames component-local findNode members to the _ui prefix", () => {
    const src =
      "sub init()\n" +
      '    m.titleLabel = m.top.findNode("titleLabel")\n' +
      "    m.titleLabel.text = \"hi\"\n" +
      "end sub\n";
    const result = formatFile({
      filePath: "Widget.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/ui-node-prefix"]),
    });

    // The fix is applied, so no warning is surfaced; the node id string is kept.
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain(
      '    m._uiTitleLabel = m.top.findNode("titleLabel")',
    );
    expect(result.output).toContain('    m._uiTitleLabel.text = "hi"');
  });

  it("does not exempt scripts by MainScene basename alone", () => {
    const src =
      "sub init()\n" +
      '    m.contentGrid = m.top.findNode("contentGrid")\n' +
      "end sub\n";
    const result = formatFile({
      filePath: "components/MainScene.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/ui-node-prefix"]),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain(
      '    m._uiContentGrid = m.top.findNode("contentGrid")',
    );
  });

  it("does not require _ui prefixes for scripts linked from a Scene component", () => {
    const xmlPath = "components/app/AppScene.xml";
    const brsPath = "components/app/AppSceneLogic.brs";
    const xml =
      '<component name="RootView" extends="Scene">\n' +
      '  <script type="text/brightscript" uri="AppSceneLogic.brs" />\n' +
      "</component>\n";
    const brs =
      "sub init()\n" +
      '    m.contentGrid = m.top.findNode("contentGrid")\n' +
      "end sub\n";
    const result = formatFile({
      filePath: brsPath,
      source: brs,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["audit/ui-node-prefix"]),
    });

    expect(result.diagnostics).toEqual([]);
  });

  it("does not require _ui prefixes for scene findNode members", () => {
    const src =
      "sub init()\n" +
      '    m.contentGrid = m.scene.findNode("contentGrid")\n' +
      '    m.hero = m.top.getScene().findNode("hero")\n' +
      "end sub\n";
    const result = formatFile({
      filePath: "Widget.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/ui-node-prefix"]),
    });

    expect(result.diagnostics).toEqual([]);
  });

  it("does not require _ui prefixes for findNode on a local scene variable", () => {
    const src =
      "sub init()\n" +
      "    _scene = m.top.getScene()\n" +
      '    m._mParticle = _scene.findNode("mParticle")\n' +
      '    m._mParticleEvent = _scene.findNode("mParticleEvent")\n' +
      "end sub\n";
    const result = formatFile({
      filePath: "UISchedule.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/ui-node-prefix"]),
    });

    expect(result.diagnostics).toEqual([]);
  });

  it("renames a UI member but leaves _-prefixed Animation/Interpolator members alone", () => {
    const xmlPath = "components/Widget.xml";
    const brsPath = "components/Widget.brs";
    const xml =
      '<component name="Widget" extends="Group">\n' +
      '  <script type="text/brightscript" uri="Widget.brs" />\n' +
      "  <children>\n" +
      '    <SequentialAnimation id="fadeAnimation" duration="0.2" />\n' +
      '    <ParallelAnimation id="slideAnimation" duration="0.2" />\n' +
      '    <FloatFieldInterpolator id="fadeInterpolator" key="[0,1]" keyValue="[0,1]" />\n' +
      '    <Vector2DFieldInterpolator id="slideInterpolator" key="[0,1]" keyValue="[0,1]" />\n' +
      '    <ColorFieldInterpolator id="tintInterpolator" key="[0,1]" keyValue="[0,1]" />\n' +
      '    <Label id="titleLabel" />\n' +
      "  </children>\n" +
      "</component>\n";
    const brs =
      "sub init()\n" +
      '    m._fadeAnimation = m.top.findNode("fadeAnimation")\n' +
      '    m._slideAnimation = m.top.findNode("slideAnimation")\n' +
      '    m._fadeInterpolator = m.top.findNode("fadeInterpolator")\n' +
      '    m._slideInterpolator = m.top.findNode("slideInterpolator")\n' +
      '    m._tintInterpolator = m.top.findNode("tintInterpolator")\n' +
      '    m.titleLabel = m.top.findNode("titleLabel")\n' +
      "end sub\n";
    const result = formatFile({
      filePath: brsPath,
      source: brs,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["audit/ui-node-prefix"]),
    });

    // The already-private animation/interpolator handles are untouched; only the
    // ordinary UI Label handle is renamed to the _ui prefix. No warnings remain.
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain('    m._fadeAnimation = m.top.findNode("fadeAnimation")');
    expect(result.output).toContain('    m._uiTitleLabel = m.top.findNode("titleLabel")');
  });

  it("renames Animation and Interpolator members to a private prefix", () => {
    const xmlPath = "components/Widget.xml";
    const brsPath = "components/Widget.brs";
    const xml =
      '<component name="Widget" extends="Group">\n' +
      '  <script type="text/brightscript" uri="Widget.brs" />\n' +
      "  <children>\n" +
      '    <SequentialAnimation id="fadeAnimation" duration="0.2" />\n' +
      '    <FloatFieldInterpolator id="fadeInterpolator" key="[0,1]" keyValue="[0,1]" />\n' +
      "  </children>\n" +
      "</component>\n";
    const brs =
      "sub init()\n" +
      '    m.fadeAnimation = m.top.findNode("fadeAnimation")\n' +
      '    m.fadeInterpolator = m.top.findNode("fadeInterpolator")\n' +
      "end sub\n";
    const result = formatFile({
      filePath: brsPath,
      source: brs,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["audit/ui-node-prefix"]),
    });

    // Animation/Interpolator handles get only a private `_` prefix, never `_ui`.
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain('    m._fadeAnimation = m.top.findNode("fadeAnimation")');
    expect(result.output).toContain('    m._fadeInterpolator = m.top.findNode("fadeInterpolator")');
    expect(result.output).not.toContain("_uiFade");
  });

  it("renames a UI handle read site in a sibling scope script", () => {
    const xmlPath = "components/player/Player.xml";
    const mainBrsPath = "components/player/Player.brs";
    const viewBrsPath = "components/player/Playerview.brs";
    const xml =
      '<component name="Player" extends="Group">\n' +
      '  <script type="text/brightscript" uri="Player.brs" />\n' +
      '  <script type="text/brightscript" uri="Playerview.brs" />\n' +
      "</component>\n";
    // The handle is assigned in Player.brs and only read in Playerview.brs.
    const mainBrs =
      "sub init()\n" +
      '    m.tileGroup = m.top.findNode("tileGroup")\n' +
      "end sub\n";
    const viewBrs =
      "sub render()\n" +
      "    m.tileGroup.visible = true\n" +
      "end sub\n";
    const projectSources = new Map([
      [xmlPath, xml],
      [mainBrsPath, mainBrs],
      [viewBrsPath, viewBrs],
    ]);

    const main = formatFile({
      filePath: mainBrsPath,
      source: mainBrs,
      config,
      projectSources,
      onlyRules: new Set(["audit/ui-node-prefix"]),
    });
    expect(main.output).toContain(
      '    m._uiTileGroup = m.top.findNode("tileGroup")',
    );

    // The sibling that only reads the handle must be rewritten too.
    const view = formatFile({
      filePath: viewBrsPath,
      source: viewBrs,
      config,
      projectSources,
      onlyRules: new Set(["audit/ui-node-prefix"]),
    });
    expect(view.diagnostics).toEqual([]);
    expect(view.output).toContain("    m._uiTileGroup.visible = true");
  });

  it("surfaces a warning when a _ui rename target already exists", () => {
    const xmlPath = "components/Widget.xml";
    const brsPath = "components/Widget.brs";
    const xml =
      '<component name="Widget" extends="Group">\n' +
      '  <script type="text/brightscript" uri="Widget.brs" />\n' +
      "</component>\n";
    // Renaming m.title → m._uiTitle collides with an existing m._uiTitle.
    const brs =
      "sub init()\n" +
      '    m.title = m.top.findNode("title")\n' +
      '    m._uiTitle = m.top.findNode("other")\n' +
      "end sub\n";
    const result = formatFile({
      filePath: brsPath,
      source: brs,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["audit/ui-node-prefix"]),
    });
    const messages = result.diagnostics.map((d) => d.message);
    expect(messages.some((m) => m.includes("already exists"))).toBe(true);
    // The colliding member is left as-is.
    expect(result.output).toContain('    m.title = m.top.findNode("title")');
  });

  it("requires non-interface primary component routines to be _-prefixed", () => {
    const xmlPath = "components/Widget.xml";
    const brsPath = "components/Widget.brs";
    const xml =
      '<component name="Widget" extends="Group">\n' +
      '  <script type="text/brightscript" uri="Widget.brs" />\n' +
      "  <interface>\n" +
      '    <function name="show" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const brs =
      "sub init()\n" +
      "end sub\n\n" +
      "sub show()\n" +
      "    helper()\n" +
      "end sub\n\n" +
      "sub helper()\n" +
      "end sub\n";
    const result = formatFile({
      filePath: brsPath,
      source: brs,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["audit/private-member-naming"]),
    });
    // The fix is applied, so no advisory warning is surfaced for it.
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain("sub show()");
    expect(result.output).toContain("    _helper()");
    expect(result.output).toContain("sub _helper()");
  });

  it("privatizes same-directory linked script routines but keeps namespaced utilities public", () => {
    const xmlPath = "components/Widget.xml";
    const brsPath = "components/WidgetHelpers.brs";
    const xml =
      '<component name="Widget" extends="Group">\n' +
      '  <script type="text/brightscript" uri="Widget.brs" />\n' +
      '  <script type="text/brightscript" uri="WidgetHelpers.brs" />\n' +
      "  <interface>\n" +
      '    <function name="show" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const brs =
      "sub helper()\n" +
      "end sub\n\n" +
      "function HTTPUtil_addQueryParams(url as string) as string\n" +
      "    return url\n" +
      "end function\n";
    const result = formatFile({
      filePath: brsPath,
      source: brs,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["audit/private-member-naming"]),
    });
    // WidgetHelpers.brs is linked (same directory as Widget.xml), so its
    // component-local `helper` becomes private; `HTTPUtil_addQueryParams` is a
    // namespaced global utility and stays public.
    expect(result.output).toContain("sub _helper()");
    expect(result.output).toContain("function HTTPUtil_addQueryParams(");
  });

  it("does not enforce private prefixes for same-named utilities linked from another component", () => {
    const xmlPath = "/project/components/screens/DeviceUtil.xml";
    const brsPath = "/project/components/dreamsocket/utils/DeviceUtil.brs";
    const xml =
      '<component name="DeviceUtil" extends="Group">\n' +
      '  <script type="text/brightscript" uri="pkg:/components/dreamsocket/utils/DeviceUtil.brs" />\n' +
      "  <interface>\n" +
      '    <function name="show" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const brs =
      "function DeviceUtil_getDeviceIdAsNumericString() as string\n" +
      '    return "0"\n' +
      "end function\n";
    const result = formatFile({
      filePath: brsPath,
      source: brs,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["audit/private-member-naming"]),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain(
      "function DeviceUtil_getDeviceIdAsNumericString()",
    );
  });

  it("still surfaces a warning when a privatization rename cannot be applied", () => {
    const xmlPath = "components/Widget.xml";
    const brsPath = "components/Widget.brs";
    const xml =
      '<component name="Widget" extends="Group">\n' +
      '  <script type="text/brightscript" uri="Widget.brs" />\n' +
      "  <interface>\n" +
      '    <function name="show" />\n' +
      "  </interface>\n" +
      "</component>\n";
    // `helper` would be privatized to `_helper`, but `_helper` already exists, so
    // the fix cannot be applied — the warning must remain visible.
    const brs =
      "sub show()\n" +
      "end sub\n\n" +
      "sub helper()\n" +
      "end sub\n\n" +
      "sub _helper()\n" +
      "end sub\n";
    const result = formatFile({
      filePath: brsPath,
      source: brs,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["audit/private-member-naming"]),
    });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.fixable).toBe(false);
    expect(result.diagnostics[0]!.message).toContain("already exists");
    expect(result.output).toBe(brs);
  });

  it("rewrites call sites in a sibling scope script when a routine is privatized", () => {
    const xmlPath = "components/player/LivePlayer.xml";
    const playerBrsPath = "components/player/LivePlayer.brs";
    const trackingBrsPath = "components/player/LivePlayertracking.brs";
    const xml =
      '<component name="LivePlayer" extends="Group">\n' +
      '  <script type="text/brightscript" uri="LivePlayer.brs" />\n' +
      '  <script type="text/brightscript" uri="LivePlayertracking.brs" />\n' +
      "  <interface>\n" +
      '    <function name="show" />\n' +
      "  </interface>\n" +
      "</component>\n";
    // trackPageLoad is declared in the tracking script (it will be privatized
    // when that file is formatted) but called from LivePlayer.brs.
    const trackingBrs =
      "sub trackPageLoad()\n" +
      "end sub\n";
    const playerBrs =
      "sub show()\n" +
      "    trackPageLoad()\n" +
      "end sub\n";
    const projectSources = new Map([
      [xmlPath, xml],
      [playerBrsPath, playerBrs],
      [trackingBrsPath, trackingBrs],
    ]);

    // Formatting LivePlayer.brs: its own routines are all public/interface, so it
    // gains no rename diagnostics, but the call to the now-private sibling
    // routine must be rewritten.
    const player = formatFile({
      filePath: playerBrsPath,
      source: playerBrs,
      config,
      projectSources,
      onlyRules: new Set(["audit/private-member-naming"]),
    });
    expect(player.output).toContain("    _trackPageLoad()");
    expect(player.output).toContain("sub show()");

    // Formatting the tracking script: the declaration itself is privatized.
    const tracking = formatFile({
      filePath: trackingBrsPath,
      source: trackingBrs,
      config,
      projectSources,
      onlyRules: new Set(["audit/private-member-naming"]),
    });
    expect(tracking.output).toContain("sub _trackPageLoad()");
  });

  it("applies the private prefix to primary-script observer handlers", () => {
    const xmlPath = "components/Widget.xml";
    const brsPath = "components/Widget.brs";
    const xml =
      '<component name="Widget" extends="Group">\n' +
      '  <script type="text/brightscript" uri="Widget.brs" />\n' +
      "  <interface>\n" +
      '    <function name="show" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const brs =
      "sub init()\n" +
      '    m.top.observeFieldScoped("focusedChild", "focusNav")\n' +
      "end sub\n\n" +
      "sub focusNav()\n" +
      "end sub\n";
    const result = formatFile({
      filePath: brsPath,
      source: brs,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["audit/private-member-naming"]),
    });
    // The rename is applied, so no advisory warning is surfaced for it.
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain(
      '    m.top.observeFieldScoped("focusedChild", "_focusNav")',
    );
    expect(result.output).toContain("sub _focusNav()");
    expect(result.output).not.toContain("_setFocusedChild");
  });

  it("does not private-prefix public interface functions used as observers", () => {
    const xmlPath = "components/Widget.xml";
    const brsPath = "components/Widget.brs";
    const xml =
      '<component name="Widget" extends="Group">\n' +
      '  <script type="text/brightscript" uri="Widget.brs" />\n' +
      "  <interface>\n" +
      '    <function name="show" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const brs =
      "sub init()\n" +
      '    m.top.observeFieldScoped("focusedChild", "show")\n' +
      "end sub\n\n" +
      "sub show()\n" +
      "end sub\n";
    const result = formatFile({
      filePath: brsPath,
      source: brs,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["audit/private-member-naming"]),
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain(
      '    m.top.observeFieldScoped("focusedChild", "show")',
    );
    expect(result.output).toContain("sub show()");
  });

  it("honors public interface functions inherited from parent components", () => {
    const parentXmlPath = "components/BaseDecoder.xml";
    const childXmlPath = "components/ProfileDecoder.xml";
    const childBrsPath = "components/ProfileDecoder.brs";
    const parentXml =
      '<component name="BaseDecoder" extends="Node">\n' +
      "  <interface>\n" +
      '    <function name="convertObject" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const childXml =
      '<component name="ProfileDecoder" extends="BaseDecoder">\n' +
      '  <script type="text/brightscript" uri="ProfileDecoder.brs" />\n' +
      "</component>\n";
    const childBrs =
      "function convertObject(value as Object) as Dynamic\n" +
      "    return value\n" +
      "end function\n";
    const result = formatFile({
      filePath: childBrsPath,
      source: childBrs,
      config,
      projectSources: new Map([
        [parentXmlPath, parentXml],
        [childXmlPath, childXml],
        [childBrsPath, childBrs],
      ]),
      onlyRules: new Set(["audit/private-member-naming"]),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain("function convertObject(");
  });

  it("never promotes a private _-prefixed routine to public", () => {
    const xmlPath = "components/Widget.xml";
    const brsPath = "components/Widget.brs";
    const xml =
      '<component name="Widget" extends="Group">\n' +
      '  <script type="text/brightscript" uri="Widget.brs" />\n' +
      "  <interface>\n" +
      '    <function name="_show" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const brs =
      "sub init()\n" +
      "    _show()\n" +
      "end sub\n\n" +
      "sub _show()\n" +
      "end sub\n";
    const result = formatFile({
      filePath: brsPath,
      source: brs,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["audit/private-member-naming"]),
    });
    // The author marked `_show` private; we never strip the `_` to make it
    // public, even though the interface lists a matching name.
    expect(result.output).toContain("    _show()");
    expect(result.output).toContain("sub _show()");
    expect(result.output).not.toContain("sub show()");
  });

  it("flags but does not auto-promote a _-prefixed XML interface function name", () => {
    const src =
      '<component name="Widget" extends="Group">\n' +
      "  <interface>\n" +
      '    <function name="_show" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const result = formatFile({
      filePath: "components/Widget.xml",
      source: src,
      config,
      onlyRules: new Set(["audit/private-member-naming"]),
    });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.fixable).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.output).toContain('<function name="_show" />');
  });

  it("diagnoses XML onChange handlers so they can move to code observers", () => {
    const src =
      '<component name="W" extends="Group">\n' +
      "  <interface>\n" +
      '    <field id="focusedChild" type="node" onChange="_focusNav" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const result = formatFile({
      filePath: "W.xml",
      source: src,
      config,
      onlyRules: new Set(["xml/no-onchange-field"]),
    });
    expect(result.changed).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain(
      'field id="focusedChild"',
    );
    expect(result.diagnostics[0]!.message).toContain(
      'm.top.observeFieldScoped("focusedChild", "_setFocusedChild")',
    );
    expect(result.diagnostics[0]!.message).not.toContain("_focusNav");
  });

  it("leaves XML with parse errors untouched", () => {
    const src = "<component name=\"X\"><interface></component>\n";
    const result = formatFile({ filePath: "Bad.xml", source: src, config });
    expect(result.status).toBe("parse-error");
    expect(result.output).toBe(src);
  });

  it("classifies tensed names as events and nouns as properties", () => {
    const xmlPath = "Timer.xml";
    const brsPath = "Timer.brs";
    const xml =
      '<component name="Timer" extends="Group">\n' +
      "  <interface>\n" +
      '    <field id="expiration" type="int" />\n' +
      '    <field id="updated" type="int" />\n' +
      '    <field id="ended" type="boolean" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const brs =
      "sub init()\n" +
      "    m.top.ended = false\n" +
      "    m.top.updated = 0\n" +
      "end sub\n";
    const result = formatFile({
      filePath: xmlPath,
      source: xml,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["xml/interface-section-order"]),
    });
    expect(result.diagnostics).toEqual([]);
    // Events (ended, updated) sort before the property (expiration).
    const order = ["ended", "updated", "expiration"].map((id) =>
      result.output.indexOf(`id="${id}"`),
    );
    expect(order[0]).toBeLessThan(order[1]!);
    expect(order[1]).toBeLessThan(order[2]!);
  });

  it("treats a compound participle as an event but a leading modifier as a property", () => {
    const xmlPath = "Nav.xml";
    const brsPath = "Nav.brs";
    const xml =
      '<component name="Nav" extends="Group">\n' +
      "  <interface>\n" +
      '    <field id="selectedItem" type="node" />\n' +
      '    <field id="itemSelected" type="node" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const result = formatFile({
      filePath: xmlPath,
      source: xml,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, "sub init()\nend sub\n"],
      ]),
      onlyRules: new Set(["xml/interface-section-order"]),
    });
    expect(result.diagnostics).toEqual([]);
    // itemSelected (event) sorts before selectedItem (property).
    expect(result.output.indexOf('id="itemSelected"')).toBeLessThan(
      result.output.indexOf('id="selectedItem"'),
    );
  });

  it("flags a standalone state participle that is both read and written", () => {
    const xmlPath = "Item.xml";
    const brsPath = "Item.brs";
    const xml =
      '<component name="Item" extends="Group">\n' +
      "  <interface>\n" +
      '    <field id="expanded" type="boolean" />\n' +
      '    <field id="label" type="string" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const brs =
      "sub _onTap()\n" +
      "    if (not m.top.expanded)\n" +
      "        m.top.expanded = true\n" +
      "    end if\n" +
      "end sub\n";
    const result = formatFile({
      filePath: xmlPath,
      source: xml,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["xml/interface-section-order"]),
    });
    expect(result.changed).toBe(false);
    expect(
      result.diagnostics.some((d) =>
        d.message.includes("Ambiguous Event/Property"),
      ),
    ).toBe(true);
  });

  it("resolves property-preferring participles to property even when read and written", () => {
    const xmlPath = "Item.xml";
    const brsPath = "Item.brs";
    const xml =
      '<component name="Item" extends="Group">\n' +
      "  <interface>\n" +
      '    <field id="selected" type="boolean" />\n' +
      '    <field id="focused" type="boolean" />\n' +
      '    <field id="label" type="string" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const brs =
      "sub _onTap()\n" +
      "    if (not m.top.selected)\n" +
      "        m.top.selected = true\n" +
      "    end if\n" +
      "    if (not m.top.focused)\n" +
      "        m.top.focused = true\n" +
      "    end if\n" +
      "end sub\n";
    const result = formatFile({
      filePath: xmlPath,
      source: xml,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["xml/interface-section-order"]),
    });
    // selected/focused classify as properties (not ambiguous), so the all-property
    // interface is already ordered and reordering proceeds without a diagnostic.
    expect(
      result.diagnostics.some((d) =>
        d.message.includes("Ambiguous Event/Property"),
      ),
    ).toBe(false);
  });

  it("treats a write-only non-tensed field as a property (events require a tense name)", () => {
    const xmlPath = "Svc.xml";
    const brsPath = "Svc.brs";
    const xml =
      '<component name="Svc" extends="Group">\n' +
      "  <interface>\n" +
      '    <field id="error" type="string" />\n' +
      '    <field id="config" type="node" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const brs =
      "sub init()\n" +
      "    cfg = m.top.config\n" +
      '    m.top.error = "boom"\n' +
      "end sub\n";
    const result = formatFile({
      filePath: xmlPath,
      source: xml,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["xml/interface-section-order"]),
    });
    expect(result.diagnostics).toEqual([]);
    // Neither field has a tense name, so both are properties (an event must be
    // tense-named AND produced). They sort alphabetically: config before error.
    expect(result.output.indexOf('id="config"')).toBeLessThan(
      result.output.indexOf('id="error"'),
    );
  });
});
