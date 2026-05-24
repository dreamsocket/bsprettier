import { emptyResult, type RuleResult } from "../../edit/types.js";
import type { Edit, Span } from "../../edit/types.js";
import type { BscToken, BrsRoutine } from "../../parser/brighterscript-adapter.js";
import { walkNodes } from "../../parser/brs-walk.js";
import type { BrsRule, BrsRuleContext } from "../rule.js";

const RULE_ID = "audit/parameter-naming";

interface ParameterRename {
  from: string;
  to: string;
  span: Span;
  collision: boolean;
}

interface RenameInput {
  from: string;
  to: string;
  span: Span;
}

interface RoutineRenamePlan {
  routine: BrsRoutine;
  nestedSpans: Span[];
  renameInputs: RenameInput[];
  targetNames: Set<string>;
  foundTargetNames: Set<string>;
  activeRenames: Map<string, string>;
}

function isParameterName(name: string): boolean {
  return /^p_/.test(name);
}

function parameterTarget(name: string): string {
  if (/^p_/i.test(name)) return `p_${name.slice(2)}`;
  return `p_${lowerCamel(name.replace(/^_+/, ""))}`;
}

function lowerCamel(name: string): string {
  const acronym = name.match(/^[A-Z]+(?=[A-Z][a-z]|[0-9]|$)/)?.[0];
  if (acronym && acronym.length > 1) {
    return acronym.toLowerCase() + name.slice(acronym.length);
  }
  return name.length === 0 ? name : name[0]!.toLowerCase() + name.slice(1);
}

function rangeSpan(ctx: BrsRuleContext, token: BscToken): Span | null {
  return token.location
    ? ctx.parse.lineIndex.rangeToSpan(token.location.range)
    : null;
}

function tokenOffset(ctx: BrsRuleContext, token: BscToken): number | null {
  return token.location
    ? ctx.parse.lineIndex.positionToOffset(token.location.range.start)
    : null;
}

function tokenEndOffset(ctx: BrsRuleContext, token: BscToken): number | null {
  return token.location
    ? ctx.parse.lineIndex.positionToOffset(token.location.range.end)
    : null;
}

function isInside(span: Span, offset: number): boolean {
  return offset >= span.offset && offset < span.offset + span.length;
}

function nestedFunctionSpans(
  ctx: BrsRuleContext,
  routine: BrsRoutine,
): Span[] {
  const spans: Span[] = [];
  for (const node of walkNodes(routine.node.func)) {
    if (node.kind !== "FunctionExpression" || node === routine.node.func) {
      continue;
    }
    if (!node.location?.range) continue;
    spans.push(ctx.parse.lineIndex.rangeToSpan(node.location.range));
  }
  return spans;
}

function isInNestedFunction(offset: number, spans: Span[]): boolean {
  return spans.some((span) => isInside(span, offset));
}

function previousSignificant(
  tokens: BscToken[],
  index: number,
): BscToken | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const token = tokens[i]!;
    if (token.kind !== "Newline" && token.kind !== "Comment") return token;
  }
  return undefined;
}

function nextSignificant(
  tokens: BscToken[],
  index: number,
): BscToken | undefined {
  for (let i = index + 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.kind !== "Newline" && token.kind !== "Comment") return token;
  }
  return undefined;
}

function isAssociativeArrayKeyOrLabel(
  tokens: BscToken[],
  index: number,
): boolean {
  return nextSignificant(tokens, index)?.kind === "Colon";
}

function isPropertyName(tokens: BscToken[], index: number): boolean {
  return previousSignificant(tokens, index)?.kind === "Dot";
}

function collectRenameInputs(
  ctx: BrsRuleContext,
  routine: BrsRoutine,
): RenameInput[] {
  const params = (routine.node.func?.parameters ?? []) as any[];
  const renameInputs: RenameInput[] = [];

  for (const param of params) {
    const token: BscToken | undefined = param.tokens?.name;
    if (!token) continue;
    const name = token.text;
    const span = rangeSpan(ctx, token);
    if (!span || isParameterName(name)) continue;

    const target = parameterTarget(name);
    renameInputs.push({
      from: name,
      to: target,
      span,
    });
  }

  return renameInputs;
}

function parameterDiagnostics(
  ctx: BrsRuleContext,
  renames: ParameterRename[],
): RuleResult["diagnostics"] {
  return renames.map((rename) => ({
    ruleId: RULE_ID,
    severity: ctx.severity,
    message: rename.collision
      ? `Parameter "${rename.from}" should use the "p_" prefix, but ` +
        `"${rename.to}" already exists in this routine.`
      : `Parameter "${rename.from}" should use the "p_" prefix; rename it ` +
        `to "${rename.to}".`,
    span: rename.span,
    fixable: !rename.collision,
  }));
}

function collectIdentifierNames(
  ctx: BrsRuleContext,
  plans: RoutineRenamePlan[],
): void {
  let planIndex = 0;
  for (const token of ctx.parse.tokens) {
    if (token.kind !== "Identifier") continue;
    const offset = tokenOffset(ctx, token);
    if (offset === null) continue;

    while (
      planIndex < plans.length &&
      offset >=
        plans[planIndex]!.routine.declSpan.offset +
          plans[planIndex]!.routine.declSpan.length
    ) {
      planIndex++;
    }

    const plan = plans[planIndex];
    if (!plan || !isInside(plan.routine.declSpan, offset)) continue;
    const name = token.text.toLowerCase();
    if (!plan.targetNames.has(name)) continue;
    if (isInNestedFunction(offset, plan.nestedSpans)) continue;
    plan.foundTargetNames.add(name);
  }
}

function applyCollisionChecks(plan: RoutineRenamePlan): ParameterRename[] {
  const targetCounts = new Map<string, number>();
  for (const rename of plan.renameInputs) {
    const key = rename.to.toLowerCase();
    targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
  }

  return plan.renameInputs.map((rename) => {
    const targetKey = rename.to.toLowerCase();
    return {
      ...rename,
      collision:
        (targetKey !== rename.from.toLowerCase() &&
          plan.foundTargetNames.has(targetKey)) ||
        (targetCounts.get(targetKey) ?? 0) > 1,
    };
  });
}

function collectRenameEdits(
  ctx: BrsRuleContext,
  plans: RoutineRenamePlan[],
): Edit[] {
  const edits: Edit[] = [];
  let planIndex = 0;
  for (let i = 0; i < ctx.parse.tokens.length; i++) {
    const token = ctx.parse.tokens[i]!;
    if (token.kind !== "Identifier") continue;

    const offset = tokenOffset(ctx, token);
    if (offset === null) continue;

    while (
      planIndex < plans.length &&
      offset >=
        plans[planIndex]!.routine.declSpan.offset +
          plans[planIndex]!.routine.declSpan.length
    ) {
      planIndex++;
    }

    const plan = plans[planIndex];
    if (!plan || !isInside(plan.routine.declSpan, offset)) continue;

    const replacement = plan.activeRenames.get(token.text.toLowerCase());
    if (!replacement) continue;
    if (isInNestedFunction(offset, plan.nestedSpans)) continue;
    if (isPropertyName(ctx.parse.tokens, i)) continue;
    if (isAssociativeArrayKeyOrLabel(ctx.parse.tokens, i)) continue;

    const endOffset = tokenEndOffset(ctx, token);
    if (endOffset === null) continue;
    edits.push({
      ruleId: RULE_ID,
      offset,
      length: endOffset - offset,
      replacement,
    });
  }

  return edits;
}

export const parameterNaming: BrsRule = {
  id: RULE_ID,
  lang: "brs",
  phase: 4,
  run(ctx: BrsRuleContext): RuleResult {
    const diagnostics: RuleResult["diagnostics"] = [];
    const plans: RoutineRenamePlan[] = [];

    for (const routine of ctx.parse.topLevelFunctions) {
      const renameInputs = collectRenameInputs(ctx, routine);
      if (renameInputs.length === 0) continue;
      const targetNames = new Set(
        renameInputs.map((rename) => rename.to.toLowerCase()),
      );
      plans.push({
        routine,
        nestedSpans: nestedFunctionSpans(ctx, routine),
        renameInputs,
        targetNames,
        foundTargetNames: new Set(),
        activeRenames: new Map(),
      });
    }

    if (plans.length === 0) return emptyResult();

    collectIdentifierNames(ctx, plans);

    for (const plan of plans) {
      const renames = applyCollisionChecks(plan);
      diagnostics.push(...parameterDiagnostics(ctx, renames));
      for (const rename of renames) {
        if (!rename.collision) {
          plan.activeRenames.set(rename.from.toLowerCase(), rename.to);
        }
      }
    }

    const edits = collectRenameEdits(
      ctx,
      plans.filter((plan) => plan.activeRenames.size > 0),
    );

    if (diagnostics.length === 0 && edits.length === 0) return emptyResult();
    return { edits, diagnostics };
  },
};
