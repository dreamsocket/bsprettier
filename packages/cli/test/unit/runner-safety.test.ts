import { describe, expect, it } from "vitest";
import { config, formatSource } from "../helpers/format.js";
import { brs, xml } from "../helpers/source.js";

describe("runner safety", () => {
  it("leaves a file with parse errors untouched", () => {
    const src = "sub foo(\nend sub\n";
    const result = formatSource({ filePath: "Broken.brs", source: src, config });
    expect(result.status).toBe("parse-error");
    expect(result.output).toBe(src);
    expect(result.changed).toBe(false);
  });

  it("honors a whole-file disable comment", () => {
    const src = brs`
      ' bsprettier-disable
      function zzz()
      end function

      sub init()
      end sub
    `;
    const result = formatSource({ filePath: "Disabled.brs", source: src, config });
    expect(result.changed).toBe(false);
    expect(result.output).toBe(src);
  });

  it("honors a rule-specific BrightScript disable-next-line comment", () => {
    const src = brs`
      sub init()
          ' bsprettier-disable-next-line brs/block-if-form
          if (m.x) then m.y = 1
          if (m.z) then m.y = 2
      end sub
    `;
    const result = formatSource({ filePath: "DisabledNext.brs", source: src, config });

    expect(result.output).toContain("    if(m.x) then m.y = 1");
    expect(result.output).toContain("    if(m.z)\n        m.y = 2\n    end if");
  });

  it("honors an XML disable-next-line comment", () => {
    const src = xml`
      <component name="W" extends="Group">
        <interface>
          <!-- bsprettier-disable-next-line xml/no-onchange-field -->
          <field id="focusedChild" type="node" onChange="_focusNav" />
        </interface>
      </component>
    `;
    const result = formatSource({
      filePath: "W.xml",
      source: src,
      config,
      onlyRules: new Set(["xml/no-onchange-field"]),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it("respects --rules style restriction via onlyRules", () => {
    const src = brs`
      sub init()
          if (m.x) then m.y = 1
      end sub
    `;
    const result = formatSource({
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

  it("adds missing parentheses after inline if conversion", () => {
    const src = brs`
      sub init()
          if m.x then m.y = 1
      end sub
    `;
    const result = formatSource({
      filePath: "InlineMissingParens.brs",
      source: src,
      config,
    });

    expect(result.output).toContain("    if(m.x)\n        m.y = 1\n    end if");
    expect(result.diagnostics).toEqual([]);
  });

  it("does not run brighterscript-formatter unless brs/format-style is selected", () => {
    const src = brs`
      SUB init()
          if (m.x) then m.y = 1
      END SUB
    `;
    const result = formatSource({
      filePath: "Selected.brs",
      source: src,
      config,
      onlyRules: new Set(["brs/if-condition-parens"]),
    });

    expect(result.ruleIds).not.toContain("brs/format-style");
    expect(result.output).toContain("SUB init()");
    expect(result.output).toContain("if(m.x) then");
    expect(result.output).toContain("END SUB");
  });

  it("runs only brs/format-style when selected explicitly", () => {
    const src = brs`
      SUB init()
          if (m.x) then m.y = 1
      END SUB
    `;
    const result = formatSource({
      filePath: "Selected.brs",
      source: src,
      config,
      onlyRules: new Set(["brs/format-style"]),
    });

    expect(result.ruleIds).toEqual(["brs/format-style"]);
    expect(result.output).toContain("sub init()");
    expect(result.output).toContain("if (m.x) then m.y = 1");
    expect(result.output).not.toContain("end if");
  });

  it("is idempotent on already-formatted output", () => {
    const src = brs`
      function _onX()
      end function

      sub init()
      end sub
    `;
    const once = formatSource({ filePath: "I.brs", source: src, config }).output;
    const twice = formatSource({ filePath: "I.brs", source: once, config }).output;
    expect(twice).toBe(once);
  });

  it("leaves XML with parse errors untouched", () => {
    const src = "<component name=\"X\"><interface></component>\n";
    const result = formatSource({ filePath: "Bad.xml", source: src, config });
    expect(result.status).toBe("parse-error");
    expect(result.output).toBe(src);
  });
});
