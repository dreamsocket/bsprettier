import { emptyResult, type Diagnostic, type RuleResult } from "../../edit/types.js";
import type { BrsRule, BrsRuleContext } from "../rule.js";

const RULE_ID = "audit/handler-intent";

/**
 * Private routines should reveal intent through their prefix: `_set*` for
 * property setters, `_on*` for event/result reactions. Flags `_`-prefixed
 * top-level routines that match neither convention.
 */
export const handlerIntent: BrsRule = {
  id: RULE_ID,
  lang: "brs",
  phase: 4,
  run(ctx: BrsRuleContext): RuleResult {
    const diagnostics: Diagnostic[] = [];
    for (const routine of ctx.parse.topLevelFunctions) {
      const name = routine.name;
      if (!name.startsWith("_")) continue;
      if (/^_(on|set|get)/i.test(name)) continue;
      diagnostics.push({
        ruleId: RULE_ID,
        severity: ctx.severity,
        message:
          `Private routine "${name}" does not use an intent-revealing ` +
          "prefix (_set* for setters, _on* for reactions).",
        span: routine.keywordSpan,
        fixable: false,
      });
    }
    if (diagnostics.length === 0) return emptyResult();
    return { edits: [], diagnostics };
  },
};
