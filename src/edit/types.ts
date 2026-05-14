export interface Span {
  /** Absolute UTF-16 code-unit index into the source string. */
  offset: number;
  /** Length in UTF-16 code units. */
  length: number;
}

export interface Edit {
  ruleId: string;
  /** Absolute UTF-16 code-unit index into the source string. */
  offset: number;
  /** Length in UTF-16 code units. */
  length: number;
  replacement: string;
}

export type Severity = "error" | "warn" | "info";

export interface Diagnostic {
  ruleId: string;
  severity: Severity;
  message: string;
  span?: Span;
  fixable: boolean;
}

export interface RuleResult {
  edits: Edit[];
  diagnostics: Diagnostic[];
}

export function emptyResult(): RuleResult {
  return { edits: [], diagnostics: [] };
}
