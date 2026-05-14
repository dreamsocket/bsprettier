import type { Edit } from "./types.js";

export interface ConflictError {
  kind: "conflict";
  ruleA: string;
  ruleB: string;
  offset: number;
}

/**
 * Apply a set of edits to `source`. Edits must not overlap (callers detect
 * intra-phase conflicts first). Edits are applied highest-offset → lowest so
 * earlier offsets stay valid.
 */
export function applyEdits(source: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.offset - a.offset);
  let result = source;
  for (const edit of sorted) {
    result =
      result.slice(0, edit.offset) +
      edit.replacement +
      result.slice(edit.offset + edit.length);
  }
  return result;
}

/**
 * Detect overlapping edits within a single phase. Returns the first conflict
 * found, or null if all edits are disjoint. Zero-length edits at the same
 * offset are also treated as conflicts.
 */
export function findConflict(edits: Edit[]): ConflictError | null {
  const sorted = [...edits].sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const prevEnd = prev.offset + prev.length;
    if (cur.offset < prevEnd) {
      return {
        kind: "conflict",
        ruleA: prev.ruleId,
        ruleB: cur.ruleId,
        offset: cur.offset,
      };
    }
    if (cur.offset === prevEnd && cur.length === 0 && prev.length === 0) {
      return {
        kind: "conflict",
        ruleA: prev.ruleId,
        ruleB: cur.ruleId,
        offset: cur.offset,
      };
    }
  }
  return null;
}

/** True if the edit would not change the source. */
export function isNoOpEdit(source: string, edit: Edit): boolean {
  return (
    source.slice(edit.offset, edit.offset + edit.length) === edit.replacement
  );
}
