import { describe, expect, it } from "vitest";
import { config, formatSource } from "../../../helpers/format.js";
import { brs as brsSource, xml as xmlSource } from "../../../helpers/source.js";

describe("audit/private-member-naming: routine privatization", () => {
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
});
