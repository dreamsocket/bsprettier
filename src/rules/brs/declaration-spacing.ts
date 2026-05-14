import { detectEol } from "../../util/eol.js";
import { emptyResult, type Edit, type RuleResult } from "../../edit/types.js";
import type { BrsRule, BrsRuleContext } from "../rule.js";

const RULE_ID = "brs/declaration-spacing";

export const declarationSpacing: BrsRule = {
  id: RULE_ID,
  lang: "brs",
  phase: 1,
  run(ctx: BrsRuleContext): RuleResult {
    const { parse, source, config } = ctx;
    const routines = parse.topLevelFunctions;
    if (routines.length === 0) return emptyResult();

    const n = Math.max(0, config.brs.blankLinesBetweenRoutines);
    const eol = detectEol(source);
    const edits: Edit[] = [];

    // Normalize the gap between consecutive top-level routines.
    for (let i = 1; i < routines.length; i++) {
      const prev = routines[i - 1]!;
      const cur = routines[i]!;
      const gapStart = prev.fullSpan.offset + prev.fullSpan.length;
      const gapEnd = cur.fullSpan.offset;
      const gap = source.slice(gapStart, gapEnd);
      // Only touch gaps that are pure whitespace — standalone comments are
      // left to declaration-order's refusal path.
      if (/\S/.test(gap)) continue;
      const wanted = eol.repeat(n + 1);
      if (gap !== wanted) {
        edits.push({
          ruleId: RULE_ID,
          offset: gapStart,
          length: gapEnd - gapStart,
          replacement: wanted,
        });
      }
    }

    // Ensure exactly one trailing newline after the final routine.
    const lastRoutine = routines[routines.length - 1]!;
    const tailStart = lastRoutine.declSpan.offset + lastRoutine.declSpan.length;
    const tail = source.slice(tailStart);
    if (!/\S/.test(tail) && tail !== eol) {
      edits.push({
        ruleId: RULE_ID,
        offset: tailStart,
        length: tail.length,
        replacement: eol,
      });
    }

    return { edits, diagnostics: [] };
  },
};
