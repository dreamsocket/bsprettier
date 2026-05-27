import { describe, expect, it } from "vitest";
import { config, formatSource } from "../../helpers/format.js";
import { brs } from "../../helpers/source.js";

describe("audit/parameter-naming", () => {
  it("renames parameters to p_ and updates routine-local references", () => {
    const src = brs`
      function render(item as object, count as integer) as object
          item = item
          result = { item: item, count: count }
          m.item = item
          item.title = count
          return item
      end function
    `;
    const result = formatSource({
      filePath: "Params.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/parameter-naming"]),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.output).toBe(brs`
      function render(p_item as object, p_count as integer) as object
          p_item = p_item
          result = { item: p_item, count: p_count }
          m.item = p_item
          p_item.title = p_count
          return p_item
      end function
    `);
  });

  it("accepts parameters that already use p_", () => {
    const src = brs`
      sub show(p_item as object)
          print p_item
      end sub
    `;
    const result = formatSource({
      filePath: "Params.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/parameter-naming"]),
    });

    expect(result.changed).toBe(false);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not rename a parameter when the p_ target already exists", () => {
    const src = brs`
      sub show(item as object, p_item as object)
          print item
      end sub
    `;
    const result = formatSource({
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
});
