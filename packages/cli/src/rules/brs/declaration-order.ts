import { classifyRoutine } from "../../classify/brs-cohort.js";
import { asciiCompare } from "../../util/ascii-sort.js";
import { detectEol } from "../../util/eol.js";
import { emptyResult, type Edit, type RuleResult } from "../../edit/types.js";
import type { BrsRoutine } from "../../parser/brighterscript-adapter.js";
import type { BrsRule, BrsRuleContext } from "../rule.js";

const RULE_ID = "brs/declaration-order";

function sortedRoutines(routines: BrsRoutine[]): BrsRoutine[] {
  return [...routines].sort((a, b) => {
    const ca = classifyRoutine(a.name);
    const cb = classifyRoutine(b.name);
    if (ca.cohort !== cb.cohort) return ca.cohort - cb.cohort;
    return asciiCompare(ca.sortKey, cb.sortKey);
  });
}

/** Offset of the start of the line containing `offset` (just after a newline). */
function lineStart(source: string, offset: number): number {
  let i = offset;
  while (i > 0 && source[i - 1] !== "\n") i--;
  return i;
}

/**
 * Offset of the topmost standalone-comment line within `[from, to)`, or -1 if
 * the gap holds no comment. Used to pull a leading comment (e.g. a section
 * label) into the block of the routine below it so it travels with that routine
 * when declarations are reordered.
 */
function firstCommentLineStart(source: string, from: number, to: number): number {
  let i = from;
  while (i < to) {
    const ls = lineStart(source, i);
    let j = ls;
    while (j < to && (source[j] === " " || source[j] === "\t")) j++;
    if (source[j] === "'" || /^rem\b/i.test(source.slice(j, j + 4))) return ls;
    // Advance to the next line.
    const nl = source.indexOf("\n", i);
    if (nl < 0 || nl >= to) break;
    i = nl + 1;
  }
  return -1;
}

export const declarationOrder: BrsRule = {
  id: RULE_ID,
  lang: "brs",
  phase: 1,
  run(ctx: BrsRuleContext): RuleResult {
    const { parse, source } = ctx;
    const routines = parse.topLevelFunctions;
    if (routines.length < 2) return emptyResult();

    // Refuse if non-routine declarations are interleaved among the routines.
    const statements: any[] = parse.ast.statements ?? [];
    const fnIndices = statements
      .map((s, i) => (s.kind === "FunctionStatement" ? i : -1))
      .filter((i) => i >= 0);
    const first = fnIndices[0]!;
    const last = fnIndices[fnIndices.length - 1]!;
    for (let i = first; i <= last; i++) {
      if (statements[i].kind !== "FunctionStatement") {
        return {
          edits: [],
          diagnostics: [
            {
              ruleId: RULE_ID,
              severity: ctx.severity,
              message:
                "Top-level routines are interleaved with namespace/class/other " +
                "declarations; declaration order left unchanged.",
              fixable: false,
            },
          ],
        };
      }
    }

    // Refuse if there are multiple `init` routines.
    const initCount = routines.filter(
      (r) => r.name.toLowerCase() === "init",
    ).length;
    if (initCount > 1) {
      return {
        edits: [],
        diagnostics: [
          {
            ruleId: RULE_ID,
            severity: ctx.severity,
            message: "Multiple init routines found; declaration order left unchanged.",
            fixable: false,
          },
        ],
      };
    }

    const desired = sortedRoutines(routines);
    const alreadyOrdered = desired.every((r, i) => r === routines[i]);
    if (alreadyOrdered) return emptyResult();

    // The movable block for each routine is its full span (banner comment +
    // declaration + trailing same-line comment) extended upward to absorb a
    // standalone comment that sits above it — a section label or note stays
    // attached to the routine it precedes and travels with it. The first
    // routine's block starts at its own span, leaving any file-level header
    // above it in place.
    const blockStart = new Map<BrsRoutine, number>();
    blockStart.set(routines[0]!, routines[0]!.fullSpan.offset);
    for (let i = 1; i < routines.length; i++) {
      const prevEnd =
        routines[i - 1]!.fullSpan.offset + routines[i - 1]!.fullSpan.length;
      const cur = routines[i]!;
      const commentStart = firstCommentLineStart(source, prevEnd, cur.fullSpan.offset);
      blockStart.set(cur, commentStart >= 0 ? commentStart : cur.fullSpan.offset);
    }

    const eol = detectEol(source);
    const routineSeparator = eol.repeat(
      Math.max(0, ctx.config.brs.blankLinesBetweenRoutines) + 1,
    );
    const regionStart = blockStart.get(routines[0]!)!;
    const lastOriginal = routines[routines.length - 1]!;
    const regionEnd = lastOriginal.fullSpan.offset + lastOriginal.fullSpan.length;

    const replacement = desired
      .map((r) =>
        source.slice(blockStart.get(r)!, r.fullSpan.offset + r.fullSpan.length),
      )
      .join(routineSeparator);

    const edit: Edit = {
      ruleId: RULE_ID,
      offset: regionStart,
      length: regionEnd - regionStart,
      replacement,
    };
    return { edits: [edit], diagnostics: [] };
  },
};
