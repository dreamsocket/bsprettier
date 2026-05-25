import { emptyResult, type RuleResult } from "../../edit/types.js";
import type { BrsRule, BrsRuleContext } from "../rule.js";

const RULE_ID = "audit/handler-intent";

/**
 * Observer handlers are named by the general public/private routine rule.
 * `_set<PropertyName>` is enforced only while migrating XML `onChange`
 * attributes, where the field id is authoritative.
 */
export const handlerIntent: BrsRule = {
  id: RULE_ID,
  lang: "brs",
  phase: 4,
  run(_ctx: BrsRuleContext): RuleResult {
    return emptyResult();
  },
};
