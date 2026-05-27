import { describe, expect, it } from "vitest";
import { config, formatSource } from "../../helpers/format.js";
import { brs as brsSource, xml as xmlSource } from "../../helpers/source.js";

describe("audit/private-member-naming", () => {
  it("treats _-prefixed ALL_CAPS member assignments as constants", () => {
    const src = brsSource`
      sub init()
          m._REGEX_FOLLOWED_BY_SLASH = CreateObject("roRegex", "/$", "")
          m.TILE_OFFSET = 1
          m._SFVodOlyEndLabel = "End"
          print m.TILE_OFFSET
          print m._SFVodOlyEndLabel
      end sub
    `;
    const result = formatSource({
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
    const src = brsSource`
      sub init()
          m.top.RemoveChild(m.BrightLineDirect)
          m.BrightLineDirect = invalid
          m.BrightLineDirect = CreateObject("roSGNode", "BrightLineDirect:BL_init")
          m.BrightLineDirect.ObserveField("state", "BrightLine_OnStateChange")
      end sub
    `;
    const result = formatSource({
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

  it("allows standalone utility functions to remain public", () => {
    const src = brsSource`
      function HTTPUtil_addQueryParams(url as string) as string
          return url
      end function
    `;
    const result = formatSource({
      filePath: "source/HTTPUtil.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/private-member-naming"]),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain("function HTTPUtil_addQueryParams(");
  });

  it("requires non-interface primary component routines to be _-prefixed", () => {
    const xmlPath = "components/Widget.xml";
    const brsPath = "components/Widget.brs";
    const xml = xmlSource`
      <component name="Widget" extends="Group">
        <script type="text/brightscript" uri="Widget.brs" />
        <interface>
          <function name="show" />
        </interface>
      </component>
    `;
    const brs = brsSource`
      sub init()
      end sub

      sub show()
          helper()
      end sub

      sub helper()
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
      onlyRules: new Set(["audit/private-member-naming"]),
    });
    // The fix is applied, so no advisory warning is surfaced for it.
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain("sub show()");
    expect(result.output).toContain("    _helper()");
    expect(result.output).toContain("sub _helper()");
  });

  it("renames indexed m function exports when component routines become private", () => {
    const xmlPath = "components/BFFDecoder.xml";
    const brsPath = "components/BFFDecoder.brs";
    const xml = xmlSource`
      <component name="BFFDecoder" extends="Group">
        <script type="text/brightscript" uri="BFFDecoder.brs" />
        <interface>
          <function name="convertObject" />
        </interface>
      </component>
    `;
    const brs = brsSource`
      sub init()
          m["createComponent"] = createComponent
      end sub

      function convertObject(value as Object) as Dynamic
          return value
      end function

      function createComponent(value as Object) as Object
          return value
      end function
    `;
    const result = formatSource({
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
      '    m["createComponent"] = _createComponent',
    );
    expect(result.output).toContain("function _createComponent(");

    const partial = brsSource`
      sub init()
          m["createComponent"] = createComponent
      end sub

      function convertObject(value as Object) as Dynamic
          return value
      end function

      function _createComponent(value as Object) as Object
          return value
      end function
    `;
    const repaired = formatSource({
      filePath: brsPath,
      source: partial,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, partial],
      ]),
      onlyRules: new Set(["audit/private-member-naming"]),
    });

    expect(repaired.diagnostics).toEqual([]);
    expect(repaired.output).toContain(
      '    m["createComponent"] = _createComponent',
    );
    expect(repaired.output).toContain("function _createComponent(");
  });

  it("privatizes same-directory linked script routines but keeps namespaced utilities public", () => {
    const xmlPath = "components/Widget.xml";
    const brsPath = "components/WidgetHelpers.brs";
    const xml = xmlSource`
      <component name="Widget" extends="Group">
        <script type="text/brightscript" uri="Widget.brs" />
        <script type="text/brightscript" uri="WidgetHelpers.brs" />
        <interface>
          <function name="show" />
        </interface>
      </component>
    `;
    const brs = brsSource`
      sub helper()
      end sub

      function HTTPUtil_addQueryParams(url as string) as string
          return url
      end function

      function HTTPUtil_2dEncode(url as string) as string
          return url
      end function
    `;
    const result = formatSource({
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
    // component-local `helper` becomes private; internally underscored
    // namespaced global utilities stay public.
    expect(result.output).toContain("sub _helper()");
    expect(result.output).toContain("function HTTPUtil_addQueryParams(");
    expect(result.output).toContain("function HTTPUtil_2dEncode(");
  });

  it("keeps constructor-style functions returning method interfaces public", () => {
    const xmlPath = "components/Widget.xml";
    const brsPath = "components/WidgetHelpers.brs";
    const xml = xmlSource`
      <component name="Widget" extends="Group">
        <script type="text/brightscript" uri="WidgetHelpers.brs" />
      </component>
    `;
    const brs = brsSource`
      function HTTPRequest() as Object
          return {
              _url: invalid,
              url: function(p_value as String)
                  m._url = p_value
                  return m
              end function,
              build: function() as Object
                  return { url: m._url }
              end function
          }
      end function

      function requestDefaults() as Object
          return { method: "GET" }
      end function
    `;
    const result = formatSource({
      filePath: brsPath,
      source: brs,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["audit/private-member-naming"]),
    });

    expect(result.output).toContain("function HTTPRequest()");
    expect(result.output).toContain("function _requestDefaults()");
  });

  it("does not rewrite sibling call sites for constructor-style functions", () => {
    const xmlPath = "components/Widget.xml";
    const widgetPath = "components/Widget.brs";
    const requestPath = "components/HTTPRequest.brs";
    const xml = xmlSource`
      <component name="Widget" extends="Group">
        <script type="text/brightscript" uri="Widget.brs" />
        <script type="text/brightscript" uri="HTTPRequest.brs" />
        <interface>
          <function name="show" />
        </interface>
      </component>
    `;
    const widget = brsSource`
      sub show()
          request = HTTPRequest()
          helper()
      end sub
    `;
    const request = brsSource`
      function HTTPRequest() as Object
          return {
              get: function()
                  return m
              end function
          }
      end function

      sub helper()
      end sub
    `;
    const result = formatSource({
      filePath: widgetPath,
      source: widget,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [widgetPath, widget],
        [requestPath, request],
      ]),
      onlyRules: new Set(["audit/private-member-naming"]),
    });

    expect(result.output).toContain("    request = HTTPRequest()");
    expect(result.output).toContain("    _helper()");
    expect(result.output).not.toContain("_HTTPRequest()");
  });

  it("does not rewrite native parseJSON calls to private alias routines", () => {
    const xmlPath = "components/JSONDecoder.xml";
    const brsPath = "components/JSONDecoder.brs";
    const xml = xmlSource`
      <component name="JSONDecoder" extends="Group">
        <script type="text/brightscript" uri="JSONDecoder.brs" />
        <interface>
          <function name="decode" />
        </interface>
      </component>
    `;
    const brs = brsSource`
      function decode(value as String) as Object
          return parseJSON(value)
      end function

      function _parseJSON(value as Object) as Object
          return value
      end function
    `;
    const result = formatSource({
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
    expect(result.output).toContain("    return parseJSON(value)");
    expect(result.output).toContain("function _parseJSON(");
    expect(result.output).not.toContain("return _parseJSON(value)");
  });

  it("does not enforce private prefixes for same-named utilities linked from another component", () => {
    const xmlPath = "/project/components/screens/DeviceUtil.xml";
    const brsPath = "/project/components/dreamsocket/utils/DeviceUtil.brs";
    const xml = xmlSource`
      <component name="DeviceUtil" extends="Group">
        <script type="text/brightscript" uri="pkg:/components/dreamsocket/utils/DeviceUtil.brs" />
        <interface>
          <function name="show" />
        </interface>
      </component>
    `;
    const brs = brsSource`
      function DeviceUtil_getDeviceIdAsNumericString() as string
          return "0"
      end function
    `;
    const result = formatSource({
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
    const xml = xmlSource`
      <component name="Widget" extends="Group">
        <script type="text/brightscript" uri="Widget.brs" />
        <interface>
          <function name="show" />
        </interface>
      </component>
    `;
    // `helper` would be privatized to `_helper`, but `_helper` already exists, so
    // the fix cannot be applied — the warning must remain visible.
    const brs = brsSource`
      sub show()
      end sub

      sub helper()
      end sub

      sub _helper()
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
    const xml = xmlSource`
      <component name="LivePlayer" extends="Group">
        <script type="text/brightscript" uri="LivePlayer.brs" />
        <script type="text/brightscript" uri="LivePlayertracking.brs" />
        <interface>
          <function name="show" />
        </interface>
      </component>
    `;
    // trackPageLoad is declared in the tracking script (it will be privatized
    // when that file is formatted) but called from LivePlayer.brs.
    const trackingBrs = brsSource`
      sub trackPageLoad()
      end sub
    `;
    const playerBrs = brsSource`
      sub show()
          trackPageLoad()
      end sub
    `;
    const projectSources = new Map([
      [xmlPath, xml],
      [playerBrsPath, playerBrs],
      [trackingBrsPath, trackingBrs],
    ]);

    // Formatting LivePlayer.brs: its own routines are all public/interface, so it
    // gains no rename diagnostics, but the call to the now-private sibling
    // routine must be rewritten.
    const player = formatSource({
      filePath: playerBrsPath,
      source: playerBrs,
      config,
      projectSources,
      onlyRules: new Set(["audit/private-member-naming"]),
    });
    expect(player.output).toContain("    _trackPageLoad()");
    expect(player.output).toContain("sub show()");

    // Formatting the tracking script: the declaration itself is privatized.
    const tracking = formatSource({
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
    const xml = xmlSource`
      <component name="Widget" extends="Group">
        <script type="text/brightscript" uri="Widget.brs" />
        <interface>
          <function name="show" />
        </interface>
      </component>
    `;
    const brs = brsSource`
      sub init()
          m.top.observeFieldScoped("focusedChild", "focusNav")
      end sub

      sub focusNav()
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
    const xml = xmlSource`
      <component name="Widget" extends="Group">
        <script type="text/brightscript" uri="Widget.brs" />
        <interface>
          <function name="show" />
        </interface>
      </component>
    `;
    const brs = brsSource`
      sub init()
          m.top.observeFieldScoped("focusedChild", "show")
      end sub

      sub show()
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
    const parentXml = xmlSource`
      <component name="BaseDecoder" extends="Node">
        <interface>
          <function name="convertObject" />
        </interface>
      </component>
    `;
    const childXml = xmlSource`
      <component name="ProfileDecoder" extends="BaseDecoder">
        <script type="text/brightscript" uri="ProfileDecoder.brs" />
      </component>
    `;
    const childBrs = brsSource`
      function convertObject(value as Object) as Dynamic
          return value
      end function
    `;
    const result = formatSource({
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
    const xml = xmlSource`
      <component name="Widget" extends="Group">
        <script type="text/brightscript" uri="Widget.brs" />
        <interface>
          <function name="_show" />
        </interface>
      </component>
    `;
    const brs = brsSource`
      sub init()
          _show()
      end sub

      sub _show()
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
      onlyRules: new Set(["audit/private-member-naming"]),
    });
    // The author marked `_show` private; we never strip the `_` to make it
    // public, even though the interface lists a matching name.
    expect(result.output).toContain("    _show()");
    expect(result.output).toContain("sub _show()");
    expect(result.output).not.toContain("sub show()");
  });

  it("flags but does not auto-promote a _-prefixed XML interface function name", () => {
    const src = xmlSource`
      <component name="Widget" extends="Group">
        <interface>
          <function name="_show" />
        </interface>
      </component>
    `;
    const result = formatSource({
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
});
