import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config.js";
import { formatFile } from "../../src/edit/runner.js";

const config = defaultConfig();

describe("runner safety", () => {
  it("leaves a file with parse errors untouched", () => {
    const src = "sub foo(\nend sub\n";
    const result = formatFile({ filePath: "Broken.brs", source: src, config });
    expect(result.status).toBe("parse-error");
    expect(result.output).toBe(src);
    expect(result.changed).toBe(false);
  });

  it("honors a whole-file disable comment", () => {
    const src = "' bsprettier-disable\nfunction zzz()\nend function\n\nsub init()\nend sub\n";
    const result = formatFile({ filePath: "Disabled.brs", source: src, config });
    expect(result.changed).toBe(false);
    expect(result.output).toBe(src);
  });

  it("respects --rules style restriction via onlyRules", () => {
    const src = "sub init()\n    if (m.x) then m.y = 1\nend sub\n";
    const result = formatFile({
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

  it("is idempotent on already-formatted output", () => {
    const src = "function _onX()\nend function\n\nsub init()\nend sub\n";
    const once = formatFile({ filePath: "I.brs", source: src, config }).output;
    const twice = formatFile({ filePath: "I.brs", source: once, config }).output;
    expect(twice).toBe(once);
  });

  it("does not rewrite an inline if with a trailing same-line comment", () => {
    const src = "sub init()\n    if (m.x) then m.y = 1 ' keep me\nend sub\n";
    const result = formatFile({ filePath: "Tc.brs", source: src, config });
    expect(result.output).toContain("' keep me");
    expect(result.output).not.toContain("end if");
    expect(result.diagnostics.some((d) => d.ruleId === "brs/block-if-form")).toBe(
      true,
    );
  });

  it("does not reorder interface members when comments sit between them", () => {
    const src =
      '<component name="W" extends="Group">\n' +
      "  <interface>\n" +
      '    <!-- z field --><field id="z" type="string" />\n' +
      '    <!-- a field --><field id="a" type="string" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const result = formatFile({ filePath: "W.xml", source: src, config });
    expect(result.changed).toBe(false);
    expect(
      result.diagnostics.some((d) => d.ruleId === "xml/interface-section-order"),
    ).toBe(true);
  });

  it("does not reorder scripts when comments sit between them", () => {
    const src =
      '<component name="W" extends="Group">\n' +
      '  <!-- z --><script type="text/brightscript" uri="pkg:/z.brs" />\n' +
      '  <!-- a --><script type="text/brightscript" uri="pkg:/a.brs" />\n' +
      "</component>\n";
    const result = formatFile({ filePath: "W.xml", source: src, config });
    expect(result.changed).toBe(false);
    expect(
      result.diagnostics.some((d) => d.ruleId === "xml/script-order"),
    ).toBe(true);
  });

  it("does not reorder interface members when a comment precedes the first", () => {
    const src =
      '<component name="W" extends="Group">\n' +
      "  <interface>\n" +
      "    <!-- z field -->\n" +
      '    <field id="z" type="string" />\n' +
      '    <field id="a" type="string" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const result = formatFile({ filePath: "W.xml", source: src, config });
    expect(result.changed).toBe(false);
    expect(
      result.diagnostics.some((d) => d.ruleId === "xml/interface-section-order"),
    ).toBe(true);
  });

  it("does not reorder scripts when a comment precedes the first", () => {
    const src =
      '<component name="W" extends="Group">\n' +
      "  <!-- z -->\n" +
      '  <script type="text/brightscript" uri="pkg:/z.brs" />\n' +
      '  <script type="text/brightscript" uri="pkg:/a.brs" />\n' +
      "</component>\n";
    const result = formatFile({ filePath: "W.xml", source: src, config });
    expect(result.changed).toBe(false);
    expect(
      result.diagnostics.some((d) => d.ruleId === "xml/script-order"),
    ).toBe(true);
  });

  it("leaves XML with parse errors untouched", () => {
    const src = "<component name=\"X\"><interface></component>\n";
    const result = formatFile({ filePath: "Bad.xml", source: src, config });
    expect(result.status).toBe("parse-error");
    expect(result.output).toBe(src);
  });
});
