import { describe, expect, it } from "vitest";
import { config, formatSource } from "../../../helpers/format.js";
import { brs as brsSource } from "../../../helpers/source.js";

describe("audit/private-member-naming: member assignments", () => {
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
});
