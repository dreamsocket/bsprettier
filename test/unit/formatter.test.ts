import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config.js";
import { formatFile } from "../../src/edit/runner.js";

describe("formatter integration", () => {
  it("formats with user defaults (casing to lower, indentation to 4 spaces)", () => {
    const config = defaultConfig();
    const src = "SUB main()\n  print \"hello\"\nEND SUB\n";
    const result = formatFile({ filePath: "main.brs", source: src, config });

    expect(result.changed).toBe(true);
    expect(result.ruleIds).toContain("brs/format-style");
    // bsfmt normalizes casing and indentation:
    // SUB -> sub, END SUB -> end sub, indentation -> 4 spaces
    expect(result.output).toBe("sub main()\n    print \"hello\"\nend sub\n");
  });

  it("respects overrides (indentation to 2 spaces, keyword casing to UPPER)", () => {
    const baseConfig = defaultConfig();
    const config = {
      ...baseConfig,
      formatter: {
        ...baseConfig.formatter,
        indentSpaceCount: 2,
        keywordCase: "upper",
      },
    };
    const src = "sub main()\n    print \"hello\"\nend sub\n";
    const result = formatFile({ filePath: "main.brs", source: src, config });

    expect(result.changed).toBe(true);
    expect(result.output).toBe("SUB main()\n  PRINT \"hello\"\nEND SUB\n");
  });

  it("does not format when formatter is disabled (set to null)", () => {
    const baseConfig = defaultConfig();
    const config = {
      ...baseConfig,
      formatter: null,
    };
    const src = "SUB main()\n  print \"hello\"\nEND SUB\n";
    const result = formatFile({ filePath: "main.brs", source: src, config });

    expect(result.changed).toBe(false);
    expect(result.output).toBe(src);
  });

  it("does not run the formatter when the source has parse errors", () => {
    const config = defaultConfig();
    const src = "sub main()\n    if m.x then\nend sub\n";
    const result = formatFile({ filePath: "error.brs", source: src, config });

    expect(result.status).toBe("parse-error");
    expect(result.output).toBe(src);
    expect(
      result.diagnostics.some((d) => d.ruleId === "brs/format-style"),
    ).toBe(false);
  });
});
