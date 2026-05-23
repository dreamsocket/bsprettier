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

  it("sorts current-directory scripts before path imports with colliding basenames", () => {
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
        '  <script type="text/brightscript" uri="ALocal.brs" />\n' +
        '  <script type="text/brightscript" uri="LaunchDarkly.brs" />\n' +
        '  <script type="text/brightscript" uri="ZLocal.brs" />\n' +
        '  <script type="text/brightscript" uri="pkg:/components/launchdarkly/LaunchDarkly.brs" />\n' +
        '  <script type="text/brightscript" uri="pkg:/source/ahelper.brs" />\n' +
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
      "end sub\n";
    const result = formatFile({
      filePath: "Constants.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/private-member-naming"]),
    });

    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      'Member "m.TILE_OFFSET" is a private constant; keep its ALL_CAPS spelling and add a leading "_" (rename to "m._TILE_OFFSET").',
      'Member "m._SFVodOlyEndLabel" should be lowerCamelCase (optionally _-prefixed for private members).',
    ]);
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

  it("requires _ui prefixes for component-local findNode members", () => {
    const src =
      "sub init()\n" +
      '    m.titleLabel = m.top.findNode("titleLabel")\n' +
      "end sub\n";
    const result = formatFile({
      filePath: "Widget.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/ui-node-prefix"]),
    });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain("m.titleLabel");
  });

  it("does not require _ui prefixes in MainScene scripts", () => {
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
  });

  it("does not require _ui prefixes for scripts linked from MainScene XML", () => {
    const xmlPath = "components/app/AppScene.xml";
    const brsPath = "components/app/AppSceneLogic.brs";
    const xml =
      '<component name="MainScene" extends="Scene">\n' +
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

  it("exempts _-prefixed Animation and Interpolator members from the _ui rule", () => {
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

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain("m.titleLabel");
    expect(result.diagnostics[0]!.message).toContain("_ui*");
  });

  it("requires a _ prefix for Animation and Interpolator members", () => {
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

    expect(result.diagnostics).toHaveLength(2);
    for (const d of result.diagnostics) {
      expect(d.message).toContain("_*");
      expect(d.message).not.toContain("_ui");
    }
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
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.fixable).toBe(true);
    expect(result.output).toContain("sub show()");
    expect(result.output).toContain("    _helper()");
    expect(result.output).toContain("sub _helper()");
  });

  it("does not require non-primary linked script routines to be _-prefixed", () => {
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
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain("sub helper()");
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
    expect(result.diagnostics).toHaveLength(1);
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

  it("requires interface component routines to be public and unprefixed", () => {
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
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.fixable).toBe(true);
    expect(result.output).toContain("    show()");
    expect(result.output).toContain("sub show()");
  });

  it("removes private prefixes from XML interface function names", () => {
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
    expect(result.diagnostics[0]!.fixable).toBe(true);
    expect(result.output).toContain('<function name="show" />');
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

  it("treats a write-only non-tensed field as an outbound event", () => {
    const xmlPath = "Svc.xml";
    const brsPath = "Svc.brs";
    const xml =
      '<component name="Svc" extends="Group">\n' +
      "  <interface>\n" +
      '    <field id="config" type="node" />\n' +
      '    <field id="error" type="string" />\n' +
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
    // error (written-only → event) sorts before config (read → property).
    expect(result.output.indexOf('id="error"')).toBeLessThan(
      result.output.indexOf('id="config"'),
    );
  });
});
