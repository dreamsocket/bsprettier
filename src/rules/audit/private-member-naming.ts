import { emptyResult, type RuleResult } from "../../edit/types.js";
import { diag, scan } from "./scan.js";
import type { BrsRule, BrsRuleContext } from "../rule.js";

const RULE_ID = "audit/private-member-naming";

/**
 * Private `m` members should be lowerCamelCase (optionally `_`-prefixed). Flags
 * `m.<name>` assignments where the member name starts with an uppercase letter.
 */
export const privateMemberNaming: BrsRule = {
  id: RULE_ID,
  lang: "brs",
  phase: 4,
  run(ctx: BrsRuleContext): RuleResult {
    const re = /\bm\.(_?[A-Z][\w]*)\s*=/g;
    const diagnostics = scan(ctx.source, re).map((m) =>
      diag(
        RULE_ID,
        ctx.severity,
        `Member "m.${m.groups[0]}" should be lowerCamelCase ` +
          "(optionally _-prefixed for private members).",
        m.offset,
        m.length,
      ),
    );
    if (diagnostics.length === 0) return emptyResult();
    return { edits: [], diagnostics };
  },
};
