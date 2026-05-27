import { describe, expect, it } from "vitest";
import { config, formatSource } from "../../helpers/format.js";
import { brs as brsSource, xml as xmlSource } from "../../helpers/source.js";

describe("audit/ui-node-prefix", () => {
  it("renames component-local findNode members to the _ui prefix", () => {
    const src = brsSource`
      sub init()
          m.titleLabel = m.top.findNode("titleLabel")
          m.titleLabel.text = "hi"
      end sub
    `;
    const result = formatSource({
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
    const src = brsSource`
      sub init()
          m.contentGrid = m.top.findNode("contentGrid")
      end sub
    `;
    const result = formatSource({
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
    const xml = xmlSource`
      <component name="RootView" extends="Scene">
        <script type="text/brightscript" uri="AppSceneLogic.brs" />
      </component>
    `;
    const brs = brsSource`
      sub init()
          m.contentGrid = m.top.findNode("contentGrid")
      end sub
    `;
    const result = formatSource({
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

  it("prefixes scene findNode members with `_` rather than `_ui`", () => {
    const src = brsSource`
      sub init()
          m.contentGrid = m.scene.findNode("contentGrid")
          m.hero = m.top.getScene().findNode("hero")
      end sub
    `;
    const result = formatSource({
      filePath: "Widget.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/ui-node-prefix"]),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain(
      '    m._contentGrid = m.scene.findNode("contentGrid")',
    );
    expect(result.output).toContain(
      '    m._hero = m.top.getScene().findNode("hero")',
    );
  });

  it("leaves already-`_`-prefixed scene findNode members alone", () => {
    const src = brsSource`
      sub init()
          _scene = m.top.getScene()
          m._mParticle = _scene.findNode("mParticle")
          m._mParticleEvent = _scene.findNode("mParticleEvent")
      end sub
    `;
    const result = formatSource({
      filePath: "UISchedule.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/ui-node-prefix"]),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain(
      '    m._mParticle = _scene.findNode("mParticle")',
    );
  });

  it("renames a UI member but leaves _-prefixed Animation/Interpolator members alone", () => {
    const xmlPath = "components/Widget.xml";
    const brsPath = "components/Widget.brs";
    const xml = xmlSource`
      <component name="Widget" extends="Group">
        <script type="text/brightscript" uri="Widget.brs" />
        <children>
          <SequentialAnimation id="fadeAnimation" duration="0.2" />
          <ParallelAnimation id="slideAnimation" duration="0.2" />
          <FloatFieldInterpolator id="fadeInterpolator" key="[0,1]" keyValue="[0,1]" />
          <Vector2DFieldInterpolator id="slideInterpolator" key="[0,1]" keyValue="[0,1]" />
          <ColorFieldInterpolator id="tintInterpolator" key="[0,1]" keyValue="[0,1]" />
          <Label id="titleLabel" />
        </children>
      </component>
    `;
    const brs = brsSource`
      sub init()
          m._fadeAnimation = m.top.findNode("fadeAnimation")
          m._slideAnimation = m.top.findNode("slideAnimation")
          m._fadeInterpolator = m.top.findNode("fadeInterpolator")
          m._slideInterpolator = m.top.findNode("slideInterpolator")
          m._tintInterpolator = m.top.findNode("tintInterpolator")
          m.titleLabel = m.top.findNode("titleLabel")
      end sub
    `;
    const result = formatSource({
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
    const xml = xmlSource`
      <component name="Widget" extends="Group">
        <script type="text/brightscript" uri="Widget.brs" />
        <children>
          <SequentialAnimation id="fadeAnimation" duration="0.2" />
          <FloatFieldInterpolator id="fadeInterpolator" key="[0,1]" keyValue="[0,1]" />
        </children>
      </component>
    `;
    const brs = brsSource`
      sub init()
          m.fadeAnimation = m.top.findNode("fadeAnimation")
          m.fadeInterpolator = m.top.findNode("fadeInterpolator")
      end sub
    `;
    const result = formatSource({
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
    const xml = xmlSource`
      <component name="Player" extends="Group">
        <script type="text/brightscript" uri="Player.brs" />
        <script type="text/brightscript" uri="Playerview.brs" />
      </component>
    `;
    // The handle is assigned in Player.brs and only read in Playerview.brs.
    const mainBrs = brsSource`
      sub init()
          m.tileGroup = m.top.findNode("tileGroup")
      end sub
    `;
    const viewBrs = brsSource`
      sub render()
          m.tileGroup.visible = true
      end sub
    `;
    const projectSources = new Map([
      [xmlPath, xml],
      [mainBrsPath, mainBrs],
      [viewBrsPath, viewBrs],
    ]);

    const main = formatSource({
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
    const view = formatSource({
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
    const xml = xmlSource`
      <component name="Widget" extends="Group">
        <script type="text/brightscript" uri="Widget.brs" />
      </component>
    `;
    // Renaming m.title → m._uiTitle collides with an existing m._uiTitle.
    const brs = brsSource`
      sub init()
          m.title = m.top.findNode("title")
          m._uiTitle = m.top.findNode("other")
      end sub
    `;
    const result = formatSource({
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
});
