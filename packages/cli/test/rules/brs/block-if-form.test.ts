import { describe, expect, it } from "vitest";
import { config, formatSource } from "../../helpers/format.js";
import { brs } from "../../helpers/source.js";

describe("brs/block-if-form", () => {
  it("does not rewrite an inline if with a trailing same-line comment", () => {
    const src = brs`
      sub init()
          if (m.x) then m.y = 1 ' keep me
      end sub
    `;
    const result = formatSource({ filePath: "Tc.brs", source: src, config });
    expect(result.output).toContain("' keep me");
    expect(result.output).not.toContain("end if");
    expect(result.diagnostics.some((d) => d.ruleId === "brs/block-if-form")).toBe(
      true,
    );
  });
});
