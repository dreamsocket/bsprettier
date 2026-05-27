import { describe, expect, it } from "vitest";
import { config, formatSource } from "../../helpers/format.js";
import { brs } from "../../helpers/source.js";

describe("brs/declaration-spacing", () => {
  it("expands a too-tight gap between top-level routines to the configured spacing", () => {
    // Default config is 3 blank lines between routines.
    const src = brs`
      sub a()
      end sub

      sub b()
      end sub
    `;
    const result = formatSource({
      filePath: "Tight.brs",
      source: src,
      config,
      onlyRules: new Set(["brs/declaration-spacing"]),
    });

    expect(result.changed).toBe(true);
    expect(result.output).toContain("end sub\n\n\n\nsub b()");
  });

  it("collapses an over-large gap between top-level routines", () => {
    const src = brs`
      sub a()
      end sub




      sub b()
      end sub
    `;
    const result = formatSource({
      filePath: "Loose.brs",
      source: src,
      config,
      onlyRules: new Set(["brs/declaration-spacing"]),
    });

    expect(result.changed).toBe(true);
    expect(result.output).toContain("end sub\n\n\n\nsub b()");
    expect(result.output).not.toContain("end sub\n\n\n\n\nsub b()");
  });

  it("leaves a correctly spaced gap untouched", () => {
    const src = "sub a()\nend sub\n\n\n\nsub b()\nend sub\n";
    const result = formatSource({
      filePath: "OK.brs",
      source: src,
      config,
      onlyRules: new Set(["brs/declaration-spacing"]),
    });

    expect(result.changed).toBe(false);
  });

  it("normalizes trailing whitespace after the final routine to a single newline", () => {
    const src = "sub a()\nend sub\n\n\n\n";
    const result = formatSource({
      filePath: "TrailingBlanks.brs",
      source: src,
      config,
      onlyRules: new Set(["brs/declaration-spacing"]),
    });

    expect(result.changed).toBe(true);
    expect(result.output).toBe("sub a()\nend sub\n");
  });
});
