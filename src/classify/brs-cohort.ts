/** Top-level routine cohorts, in required declaration order. */
export enum Cohort {
  Init = 0,
  Public = 1,
  Private = 2,
  Observer = 3,
}

export interface CohortClassification {
  cohort: Cohort;
  /** Name used for ASCII sorting within the cohort. */
  sortKey: string;
}

/**
 * Classify a top-level routine into a cohort.
 *
 * - `init` (case-insensitive) → Init.
 * - `_on*` handlers → Observer.
 * - `onKeyEvent` → Observer, sorting as the virtual name `_onKeyEvent`.
 * - other `_`-prefixed names (including `_set*`) → Private.
 * - everything else → Public.
 */
export function classifyRoutine(name: string): CohortClassification {
  const lower = name.toLowerCase();
  if (lower === "init") {
    return { cohort: Cohort.Init, sortKey: name };
  }
  if (lower === "onkeyevent") {
    return { cohort: Cohort.Observer, sortKey: "_onKeyEvent" };
  }
  if (name.startsWith("_")) {
    if (/^_on/i.test(name)) {
      return { cohort: Cohort.Observer, sortKey: name };
    }
    return { cohort: Cohort.Private, sortKey: name };
  }
  return { cohort: Cohort.Public, sortKey: name };
}
