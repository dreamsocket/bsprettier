/**
 * Maps between LSP-style {line, character} positions and absolute UTF-16
 * code-unit offsets into a source string.
 *
 * - `line` is 0-based.
 * - `character` is a 0-based UTF-16 code-unit offset within the line (LSP
 *   semantics, which match JavaScript string indexing).
 * - All offsets returned are absolute UTF-16 code-unit indices.
 */
export class LineIndex {
  /** Offset of the first character of each line. */
  private readonly lineStarts: number[];
  private readonly sourceLength: number;

  constructor(source: string) {
    this.sourceLength = source.length;
    const starts = [0];
    for (let i = 0; i < source.length; i++) {
      if (source[i] === "\n") {
        starts.push(i + 1);
      }
    }
    this.lineStarts = starts;
  }

  get lineCount(): number {
    return this.lineStarts.length;
  }

  positionToOffset(pos: { line: number; character: number }): number {
    const line = clamp(pos.line, 0, this.lineStarts.length - 1);
    const start = this.lineStarts[line]!;
    const nextStart =
      line + 1 < this.lineStarts.length
        ? this.lineStarts[line + 1]!
        : this.sourceLength + 1;
    // nextStart - 1 keeps the offset within the line (before the newline).
    const maxChar = Math.max(0, nextStart - 1 - start);
    return start + clamp(pos.character, 0, maxChar);
  }

  offsetToPosition(offset: number): { line: number; character: number } {
    const clamped = clamp(offset, 0, this.sourceLength);
    // Binary search for the greatest lineStart <= clamped.
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid]! <= clamped) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, character: clamped - this.lineStarts[lo]! };
  }

  rangeToSpan(range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  }): { offset: number; length: number } {
    const offset = this.positionToOffset(range.start);
    const end = this.positionToOffset(range.end);
    return { offset, length: Math.max(0, end - offset) };
  }
}

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
