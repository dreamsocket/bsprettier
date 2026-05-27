import { describe, expect, it } from "vitest";
import { config, formatSource } from "../../helpers/format.js";
import { brs } from "../../helpers/source.js";

describe("brs/if-condition-parens", () => {
  it("adds missing parentheses to simple if and else if conditions", () => {
    const src = brs`
      sub init()
          if m.x then
              m.y = 1
          else if not m.z then
              m.y = 2
          end if
      end sub
    `;
    const result = formatSource({
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
    const src = brs`
      sub init()
          if m.x = true and not m.z then
              m.y = 1
          end if
      end sub
    `;
    const result = formatSource({
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
    const src = brs`
      sub init()
          if (m.x) then m.y = 1
      end sub
    `;
    const result = formatSource({
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
    const src = brs`
      sub init()
          if m.x then m.y = 1
      end sub
    `;
    const result = formatSource({
      filePath: "InlineOnlyMissingParens.brs",
      source: src,
      config,
      onlyRules: new Set(["brs/if-condition-parens"]),
    });

    expect(result.output).toContain("if(m.x) then m.y = 1");
    expect(result.output).not.toContain("end if");
    expect(result.diagnostics).toEqual([]);
  });
});
