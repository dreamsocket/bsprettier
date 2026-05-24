/**
 * Opt-in format instrumentation. Disabled by default and gated behind a single
 * boolean check, so production formatting pays no measurable cost. The benchmark
 * harness flips `enabled` to split the format phase into its internal slices:
 * parse (brs/xml), the brighterscript-formatter pass (bsfmt), rule execution,
 * and edit application. `parseBrs`/`parseXml` and the runner wrap their inner
 * work only when enabled.
 */
export interface FormatMetrics {
  enabled: boolean;
  /**
   * When true (and `enabled`), also time each individual `rule.run()` and
   * accumulate by rule id into `ruleMs`/`ruleCount`. This adds a per-call
   * performance.now() pair, so it inflates the `rulesMs` aggregate slightly —
   * keep it off for the clean slice breakdown, on for per-rule profiling.
   */
  perRule: boolean;
  /** brighterscript lexer/parser */
  brsCount: number;
  brsMs: number;
  /** xml parser */
  xmlCount: number;
  xmlMs: number;
  /** brighterscript-formatter (bsfmt) final pass */
  bsfmtCount: number;
  bsfmtMs: number;
  /** AST rule.run() execution (whole rules loop, per phase) */
  rulesMs: number;
  /** applyEdits() text splicing */
  applyMs: number;
  /** per-rule cumulative ms, keyed by rule id (only when `perRule`) */
  ruleMs: Map<string, number>;
  /** per-rule invocation count, keyed by rule id (only when `perRule`) */
  ruleCount: Map<string, number>;
}

export const formatMetrics: FormatMetrics = {
  enabled: false,
  perRule: false,
  brsCount: 0,
  brsMs: 0,
  xmlCount: 0,
  xmlMs: 0,
  bsfmtCount: 0,
  bsfmtMs: 0,
  rulesMs: 0,
  applyMs: 0,
  ruleMs: new Map(),
  ruleCount: new Map(),
};

export function resetFormatMetrics(): void {
  formatMetrics.brsCount = 0;
  formatMetrics.brsMs = 0;
  formatMetrics.xmlCount = 0;
  formatMetrics.xmlMs = 0;
  formatMetrics.bsfmtCount = 0;
  formatMetrics.bsfmtMs = 0;
  formatMetrics.rulesMs = 0;
  formatMetrics.applyMs = 0;
  formatMetrics.ruleMs.clear();
  formatMetrics.ruleCount.clear();
}
