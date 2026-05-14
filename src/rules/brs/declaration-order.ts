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

/** True if `text` contains a BrightScript comment marker. */
function containsComment(text: string): boolean {
  return /'/.test(text) || /\bREM\b/i.test(text);
}

export const declarationOrder: BrsRule = {
  id: RULE_ID,
  lang: "brs",
  phase: 0,
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

    // Refuse if standalone (non-banner) comments sit between routines — moving
    // routines around them would lose or misplace the comments.
    for (let i = 1; i < routines.length; i++) {
      const gap = source.slice(
        routines[i - 1]!.fullSpan.offset + routines[i - 1]!.fullSpan.length,
        routines[i]!.fullSpan.offset,
      );
      if (containsComment(gap)) {
        return {
          edits: [],
          diagnostics: [
            {
              ruleId: RULE_ID,
              severity: ctx.severity,
              message:
                "Standalone comments sit between top-level routines; " +
                "declaration order left unchanged to avoid losing them.",
              fixable: false,
            },
          ],
        };
      }
    }

    const desired = sortedRoutines(routines);
    const alreadyOrdered = desired.every((r, i) => r === routines[i]);
    if (alreadyOrdered) return emptyResult();

    const eol = detectEol(source);
    const regionStart = routines[0]!.fullSpan.offset;
    const lastOriginal = routines[routines.length - 1]!;
    const regionEnd = lastOriginal.fullSpan.offset + lastOriginal.fullSpan.length;

    const replacement = desired
      .map((r) => source.slice(r.fullSpan.offset, r.fullSpan.offset + r.fullSpan.length))
      .join(eol + eol);

    const edit: Edit = {
      ruleId: RULE_ID,
      offset: regionStart,
      length: regionEnd - regionStart,
      replacement,
    };
    return { edits: [edit], diagnostics: [] };
  },
};
