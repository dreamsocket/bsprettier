export interface IndentInfo {
  /** The indent unit used by the file, e.g. "\t" or "    ". */
  unit: string;
  /** Whether the file uses tabs. */
  usesTabs: boolean;
}

/**
 * Detect the file's indent unit from the first indented line. Returns null if
 * indentation cannot be confidently determined.
 */
export function detectIndentUnit(source: string): IndentInfo | null {
  const lines = source.split(/\r?\n/);
  for (const line of lines) {
    const m = /^([ \t]+)\S/.exec(line);
    if (!m) continue;
    const ws = m[1]!;
    if (ws.includes("\t")) {
      return { unit: "\t", usesTabs: true };
    }
    // spaces — use the run length as the unit
    return { unit: ws, usesTabs: false };
  }
  return null;
}

/** Extract the leading whitespace (indentation) of the line containing `offset`. */
export function lineIndentAt(source: string, offset: number): string {
  let lineStart = offset;
  while (lineStart > 0 && source[lineStart - 1] !== "\n") lineStart--;
  let i = lineStart;
  while (i < source.length && (source[i] === " " || source[i] === "\t")) i++;
  return source.slice(lineStart, i);
}
