/**
 * Opt-in parse instrumentation. Disabled by default and gated behind a single
 * boolean check, so production parsing pays no measurable cost. The benchmark
 * harness flips `enabled` to count parser invocations and accumulate parse time
 * (used to size the repeated-parse cost of the multi-phase formatter).
 */
export interface ParseMetrics {
  enabled: boolean;
  brsCount: number;
  brsMs: number;
  xmlCount: number;
  xmlMs: number;
}

export const parseMetrics: ParseMetrics = {
  enabled: false,
  brsCount: 0,
  brsMs: 0,
  xmlCount: 0,
  xmlMs: 0,
};

export function resetParseMetrics(): void {
  parseMetrics.brsCount = 0;
  parseMetrics.brsMs = 0;
  parseMetrics.xmlCount = 0;
  parseMetrics.xmlMs = 0;
}
