import { describe, expect, it } from "vitest";
import { LineIndex } from "../../src/util/line-index.js";

describe("LineIndex", () => {
  it("maps offsets for LF source", () => {
    const src = "abc\ndef\nghi";
    const li = new LineIndex(src);
    expect(li.offsetToPosition(0)).toEqual({ line: 0, character: 0 });
    expect(li.offsetToPosition(4)).toEqual({ line: 1, character: 0 });
    expect(li.positionToOffset({ line: 1, character: 2 })).toBe(6);
    expect(li.positionToOffset({ line: 2, character: 0 })).toBe(8);
  });

  it("handles CRLF line endings", () => {
    const src = "ab\r\ncd\r\nef";
    const li = new LineIndex(src);
    // line starts after each \n
    expect(li.positionToOffset({ line: 1, character: 0 })).toBe(4);
    expect(li.positionToOffset({ line: 2, character: 1 })).toBe(9);
  });

  it("handles tabs as single code units", () => {
    const src = "\t\tx\ny";
    const li = new LineIndex(src);
    expect(li.positionToOffset({ line: 0, character: 2 })).toBe(2);
    expect(li.positionToOffset({ line: 1, character: 0 })).toBe(4);
  });

  it("handles surrogate-pair characters (emoji)", () => {
    // "ab😀c" — the emoji is 2 UTF-16 code units.
    const src = "ab\u{1F600}c\nnext";
    const li = new LineIndex(src);
    // a(1) b(1) emoji(2) c(1) \n(1) = newline at index 5, line 1 starts at 6
    expect(li.positionToOffset({ line: 1, character: 0 })).toBe(6);
    expect(li.offsetToPosition(6)).toEqual({ line: 1, character: 0 });
  });

  it("round-trips range to span", () => {
    const src = "hello\nworld";
    const li = new LineIndex(src);
    const span = li.rangeToSpan({
      start: { line: 0, character: 1 },
      end: { line: 1, character: 3 },
    });
    expect(span).toEqual({ offset: 1, length: 8 });
  });
});
