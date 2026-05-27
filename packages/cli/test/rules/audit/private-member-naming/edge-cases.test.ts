import { describe, expect, it } from "vitest";
import { config, formatSource } from "../../../helpers/format.js";
import { brs as brsSource, xml as xmlSource } from "../../../helpers/source.js";

describe("audit/private-member-naming: edge cases", () => {
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
