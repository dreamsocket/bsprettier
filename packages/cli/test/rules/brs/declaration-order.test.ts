import { describe, expect, it } from "vitest";
import { config, formatSource } from "../../helpers/format.js";
import { brs } from "../../helpers/source.js";

describe("brs/declaration-order", () => {
  it("refuses declaration reordering when routines are interleaved with other top-level declarations", () => {
    const src = brs`
      sub zzz()
      end sub

      namespace Example
      end namespace

      sub init()
      end sub
    `;
    const result = formatSource({
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
    const src = brs`
      sub zzz()
      end sub

      sub init()
      end sub

      sub init()
      end sub
    `;
    const result = formatSource({
      filePath: "MultipleInit.brs",
      source: src,
      config,
      onlyRules: new Set(["brs/declaration-order"]),
    });

    expect(result.changed).toBe(false);
    expect(result.output).toBe(src);
    expect(result.diagnostics[0]?.message).toContain("Multiple init");
  });

  it("orders internally underscored utility routines with public routines", () => {
    const src = brs`
      sub _privateHelper()
      end sub

      function HTTPUtil_addQueryParams()
      end function

      sub init()
      end sub
    `;
    const result = formatSource({
      filePath: "UtilityOrder.brs",
      source: src,
      config,
      onlyRules: new Set(["brs/declaration-order"]),
    });

    expect(result.output.indexOf("sub init()")).toBeLessThan(
      result.output.indexOf("function HTTPUtil_addQueryParams()"),
    );
    expect(result.output.indexOf("function HTTPUtil_addQueryParams()")).toBeLessThan(
      result.output.indexOf("sub _privateHelper()"),
    );
  });
});
