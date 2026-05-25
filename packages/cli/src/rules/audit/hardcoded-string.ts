import { emptyResult, type RuleResult } from "../../edit/types.js";
import { diag, scan } from "./scan.js";
import type { BrsRule, BrsRuleContext } from "../rule.js";

const RULE_ID = "audit/hardcoded-string";

/**
 * User-facing strings should be sourced via `ResourceUtil_getString(...)`.
 * Flags non-empty string literals assigned to a `.text` field.
 */
export const hardcodedString: BrsRule = {
  id: RULE_ID,
  lang: "brs",
  phase: 4,
  run(ctx: BrsRuleContext): RuleResult {
    const re = /\.text\s*=\s*"([^"\n]+)"/g;
    const diagnostics = scan(ctx.source, re).map((m) =>
      diag(
        RULE_ID,
        ctx.severity,
        "User-facing string assigned directly to .text; prefer " +
          "ResourceUtil_getString(...).",
        m.offset,
        m.length,
      ),
    );
    if (diagnostics.length === 0) return emptyResult();
    return { edits: [], diagnostics };
  },
};
