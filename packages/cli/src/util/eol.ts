export type Eol = "\n" | "\r\n";

/** Detect the dominant line ending in a source string. */
export function detectEol(source: string): Eol {
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") {
      if (i > 0 && source[i - 1] === "\r") crlf++;
      else lf++;
    }
  }
  return crlf > lf ? "\r\n" : "\n";
}

export function hasBom(source: string): boolean {
  return source.charCodeAt(0) === 0xfeff;
}

export function stripBom(source: string): string {
  return hasBom(source) ? source.slice(1) : source;
}
