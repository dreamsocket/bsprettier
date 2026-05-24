import { findNodesOfKind } from "../../parser/brs-walk.js";
import { detectEol } from "../../util/eol.js";
import { detectIndentUnit, lineIndentAt } from "../../util/indent.js";
import {
  emptyResult,
  type Diagnostic,
  type Edit,
  type RuleResult,
} from "../../edit/types.js";
import type { BrsRule, BrsRuleContext } from "../rule.js";

const RULE_ID = "brs/block-if-form";

export const blockIfForm: BrsRule = {
  id: RULE_ID,
  lang: "brs",
  phase: 3,
  run(ctx: BrsRuleContext): RuleResult {
    const { parse, source } = ctx;
    const { lineIndex } = parse;
    const eol = detectEol(source);
    const indentInfo = detectIndentUnit(source);

    const edits: Edit[] = [];
    const diagnostics: Diagnostic[] = [];

    for (const node of findNodesOfKind(parse.ast, "IfStatement")) {
      if (node.isInline !== true) continue;
      if (node.elseBranch != null) continue;
      const thenStatements = node.thenBranch?.statements ?? [];
      if (thenStatements.length !== 1) continue;

      const condition = node.condition;
      const ifToken = node.tokens?.if;
      const stmt = thenStatements[0];
      if (!condition?.location || !ifToken?.location || !stmt?.location) {
        continue;
      }

      const ifSpan = lineIndex.rangeToSpan(node.location.range);
      const condSpan = lineIndex.rangeToSpan(condition.location.range);
      const stmtSpan = lineIndex.rangeToSpan(stmt.location.range);
      const ifKwSpan = lineIndex.rangeToSpan(ifToken.location.range);

      const conditionText = source.slice(
        condSpan.offset,
        condSpan.offset + condSpan.length,
      );
      const statementText = source.slice(
        stmtSpan.offset,
        stmtSpan.offset + stmtSpan.length,
      );

      // Ambiguity guard: a multi-line condition or statement is not a simple
      // inline-if we can safely reflow.
      if (/[\r\n]/.test(conditionText) || /[\r\n]/.test(statementText)) {
        continue;
      }

      // A trailing same-line comment after the consequent statement cannot be
      // safely relocated into block form — skip and diagnose instead. BSC's
      // IfStatement span does not cover this trivia, so it would otherwise be
      // stranded on the generated `end if` line.
      const stmtEnd = stmtSpan.offset + stmtSpan.length;
      const ifSpanEnd = ifSpan.offset + ifSpan.length;
      let lineEnd = Math.max(stmtEnd, ifSpanEnd);
      while (
        lineEnd < source.length &&
        source[lineEnd] !== "\n" &&
        source[lineEnd] !== "\r"
      ) {
        lineEnd++;
      }
      const tail = source.slice(stmtEnd, lineEnd);
      if (/\S/.test(tail)) {
        diagnostics.push({
          ruleId: RULE_ID,
          severity: ctx.severity,
          message:
            "Inline if has a trailing same-line comment that cannot be " +
            "safely relocated; left unchanged.",
          span: ifSpan,
          fixable: false,
        });
        continue;
      }

      if (!indentInfo) {
        diagnostics.push({
          ruleId: RULE_ID,
          severity: ctx.severity,
          message:
            "Cannot determine indentation unit; inline if left unchanged.",
          span: ifSpan,
          fixable: false,
        });
        continue;
      }

      const baseIndent = lineIndentAt(source, ifKwSpan.offset);
      const innerIndent = baseIndent + indentInfo.unit;
      const ifKeywordText = source.slice(
        ifKwSpan.offset,
        ifKwSpan.offset + ifKwSpan.length,
      );

      // Preserve the condition text byte-for-byte; parentheses and keyword
      // spacing are handled later by brs/if-condition-parens.
      const replacement =
        `${ifKeywordText} ${conditionText}${eol}` +
        `${innerIndent}${statementText}${eol}` +
        `${baseIndent}end if`;

      edits.push({
        ruleId: RULE_ID,
        offset: ifSpan.offset,
        length: ifSpan.length,
        replacement,
      });
    }

    if (edits.length === 0 && diagnostics.length === 0) return emptyResult();
    return { edits, diagnostics };
  },
};
