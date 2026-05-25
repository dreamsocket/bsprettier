/** Deterministic ASCII-ascending comparison (case-sensitive, code-unit order). */
export function asciiCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Case-insensitive ASCII comparison, with case as a stable tie-breaker. */
export function asciiCompareCI(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la < lb) return -1;
  if (la > lb) return 1;
  return asciiCompare(a, b);
}
