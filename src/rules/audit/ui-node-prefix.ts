import { emptyResult, type RuleResult } from "../../edit/types.js";
import { diag, scan } from "./scan.js";
import type { BrsRule, BrsRuleContext } from "../rule.js";

const RULE_ID = "audit/ui-node-prefix";

/**
 * UI node references obtained via `findNode` should be stored on members named
 * `m._ui*`. Flags `m.<name> = ... findNode(...)` where the member name does not
 * start with `_ui`.
 */
export const uiNodePrefix: BrsRule = {
  id: RULE_ID,
  lang: "brs",
  phase: 4,
  run(ctx: BrsRuleContext): RuleResult {
    const re = /\bm\.([A-Za-z_][\w]*)\s*=\s*[^\n']*\.findNode\s*\(/g;
    const diagnostics = scan(ctx.source, re)
      .filter((m) => !/^_ui/i.test(m.groups[0] ?? ""))
      .map((m) =>
        diag(
          RULE_ID,
          ctx.severity,
          `UI node member "m.${m.groups[0]}" should use the m._ui* prefix.`,
          m.offset,
          m.length,
        ),
      );
    if (diagnostics.length === 0) return emptyResult();
    return { edits: [], diagnostics };
  },
};
