import type { Diagnostic, Severity } from "../../edit/types.js";

export interface ScanMatch {
  offset: number;
  length: number;
  text: string;
  groups: string[];
}

/** Run a global regex over source and yield each match with absolute offsets. */
export function scan(source: string, re: RegExp): ScanMatch[] {
  const matches: ScanMatch[] = [];
  const global = re.global ? re : new RegExp(re.source, re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = global.exec(source)) !== null) {
    matches.push({
      offset: m.index,
      length: m[0].length,
      text: m[0],
      groups: m.slice(1).map((g) => g ?? ""),
    });
    if (m[0].length === 0) global.lastIndex++;
  }
  return matches;
}

export function diag(
  ruleId: string,
  severity: Severity,
  message: string,
  offset: number,
  length: number,
): Diagnostic {
  return {
    ruleId,
    severity,
    message,
    span: { offset, length },
    fixable: false,
  };
}
