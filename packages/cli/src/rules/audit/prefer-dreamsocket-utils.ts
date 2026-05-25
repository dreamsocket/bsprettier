import { emptyResult, type Diagnostic, type RuleResult } from "../../edit/types.js";
import { scan, diag } from "./scan.js";
import type { BrsRule, BrsRuleContext } from "../rule.js";

const RULE_ID = "audit/prefer-dreamsocket-utils";

const SUGGESTIONS: { re: RegExp; util: string }[] = [
  { re: /\bUCase\s*\(/gi, util: "StringUtil_*" },
  { re: /\bLCase\s*\(/gi, util: "StringUtil_*" },
  { re: /\bMid\s*\(/gi, util: "StringUtil_*" },
  { re: /\bInstr\s*\(/gi, util: "StringUtil_*" },
  { re: /\bType\s*\(/gi, util: "TypeUtil_*" },
];

/**
 * Prefer Dreamsocket helper namespaces (`StringUtil_*`, `TypeUtil_*`,
 * `ArrayUtil_*`, `ResourceUtil_*`) over ad-hoc builtin calls.
 */
export const preferDreamsocketUtils: BrsRule = {
  id: RULE_ID,
  lang: "brs",
  phase: 4,
  run(ctx: BrsRuleContext): RuleResult {
    const diagnostics: Diagnostic[] = [];
    for (const { re, util } of SUGGESTIONS) {
      for (const m of scan(ctx.source, re)) {
        diagnostics.push(
          diag(
            RULE_ID,
            ctx.severity,
            `Consider a Dreamsocket helper (${util}) instead of "${m.text.trim()}".`,
            m.offset,
            m.length,
          ),
        );
      }
    }
    if (diagnostics.length === 0) return emptyResult();
    return { edits: [], diagnostics };
  },
};
