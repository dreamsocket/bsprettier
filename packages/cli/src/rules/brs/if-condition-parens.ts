import { findNodesOfKind } from "../../parser/brs-walk.js";
import {
  emptyResult,
  type Diagnostic,
  type Edit,
  type RuleResult,
} from "../../edit/types.js";
import type { BrsRule, BrsRuleContext } from "../rule.js";

const RULE_ID = "brs/if-condition-parens";

export const ifConditionParens: BrsRule = {
  id: RULE_ID,
  lang: "brs",
  phase: 4,
  run(ctx: BrsRuleContext): RuleResult {
    const { parse, source } = ctx;
    const { lineIndex } = parse;
    const edits: Edit[] = [];
    const diagnostics: Diagnostic[] = [];

    for (const node of findNodesOfKind(parse.ast, "IfStatement")) {
      const ifToken = node.tokens?.if;
      const condition = node.condition;
      if (!ifToken?.location || !condition?.location) continue;

      const ifEnd = lineIndex.positionToOffset(ifToken.location.range.end);

      if (condition.kind !== "GroupingExpression") {
        const conditionSpan = lineIndex.rangeToSpan(condition.location.range);
        const conditionStart = conditionSpan.offset;
        const conditionEnd = conditionSpan.offset + conditionSpan.length;
        if (conditionStart <= ifEnd) continue;

        const conditionText = source.slice(conditionStart, conditionEnd);
        if (/[\r\n]/.test(conditionText)) {
          diagnostics.push({
            ruleId: RULE_ID,
            severity: "info",
            message:
              "if condition spans multiple lines; parentheses were not added.",
            span: lineIndex.rangeToSpan(node.location.range),
            fixable: false,
          });
          continue;
        }

        const between = source.slice(ifEnd, conditionStart);
        // Leave it alone if a comment sits between the keyword and condition.
        if (between.includes("'")) continue;

        edits.push(
          {
            ruleId: RULE_ID,
            offset: ifEnd,
            length: conditionStart - ifEnd,
            replacement: "",
          },
          {
            ruleId: RULE_ID,
            offset: conditionStart,
            length: 0,
            replacement: "(",
          },
          {
            ruleId: RULE_ID,
            offset: conditionEnd,
            length: 0,
            replacement: ")",
          },
        );
        continue;
      }

      const leftParen = condition.tokens?.leftParen;
      if (!leftParen?.location) continue;

      const parenStart = lineIndex.positionToOffset(
        leftParen.location.range.start,
      );
      if (parenStart <= ifEnd) continue;

      const between = source.slice(ifEnd, parenStart);
      // Leave it alone if a comment sits between the keyword and the paren.
      if (between.includes("'")) continue;
      if (between.length === 0) continue;

      edits.push({
        ruleId: RULE_ID,
        offset: ifEnd,
        length: parenStart - ifEnd,
        replacement: "",
      });
    }

    if (edits.length === 0 && diagnostics.length === 0) return emptyResult();
    return { edits, diagnostics };
  },
};
