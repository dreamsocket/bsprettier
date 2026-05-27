import { emptyResult, type RuleResult } from "../../edit/types.js";
import type { Edit } from "../../edit/types.js";
import { walkElements } from "../../parser/xml.js";
import type { BscToken, BrsRoutine } from "../../parser/brighterscript-adapter.js";
import { attrValue, tagNameEquals } from "../../parser/xml-helpers.js";
import { scan } from "./scan.js";
import type { BrsRule, BrsRuleContext, XmlRule, XmlRuleContext } from "../rule.js";

const RULE_ID = "audit/private-member-naming";

function isFrameworkRoutine(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "init" || lower === "onkeyevent";
}

const NATIVE_GLOBAL_CALL_EXCEPTIONS = new Set(["parsejson"]);

function isNativeGlobalCallException(name: string): boolean {
  return NATIVE_GLOBAL_CALL_EXCEPTIONS.has(name.toLowerCase());
}

/**
 * Namespaced global helpers follow the `Namespace_method` convention
 * (`StringUtil_trim`, `HTTPUtil_addQueryParams`, `DeviceUtil_getId`). Any
 * underscore after the first character is treated as the package/namespace
 * separator. A leading underscore still marks a private routine, so it does not
 * qualify for this utility exception.
 */
function isNamespacedGlobal(name: string): boolean {
  return name.indexOf("_") > 0;
}

function isReturnedInterfaceLiteral(node: any): boolean {
  if (node?.kind !== "AALiteralExpression") return false;
  return (node.elements ?? []).some(
    (element: any) => element?.value?.kind === "FunctionExpression",
  );
}

function returnsInterfaceLiteral(routine: BrsRoutine): boolean {
  if (routine.isSub) return false;

  const stack = [...(routine.node.func?.body?.statements ?? [])];
  const seen = new Set<object>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (node.kind === "FunctionExpression") continue;
    if (node.kind === "ReturnStatement" && isReturnedInterfaceLiteral(node.value)) {
      return true;
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === "parent" || key === "tokens" || key === "location") continue;
      if (key === "symbolTable" || key === "visitMode") continue;
      if (Array.isArray(value)) {
        stack.push(...value);
      } else if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }

  return false;
}

function publicRoutineKey(name: string): string {
  return name.startsWith("_") ? name.slice(1).toLowerCase() : name.toLowerCase();
}

function privateRoutineCandidates(
  routines: BrsRoutine[],
  publicNames: Set<string>,
): BrsRoutine[] {
  return routines.filter(
    (routine) =>
      !routine.name.startsWith("_") &&
      !isFrameworkRoutine(routine.name) &&
      !isNamespacedGlobal(routine.name) &&
      !returnsInterfaceLiteral(routine) &&
      !publicNames.has(publicRoutineKey(routine.name)),
  );
}

/**
 * The rename map a component-local script produces for its own routines: each
 * private candidate renamed to its `_`-prefixed form, skipping any whose target
 * name already exists in that script. Used to mirror a sibling script's renames
 * onto call sites in the file currently being formatted, so the decision matches
 * what the sibling's own run would make.
 */
function computeRenamesForRoutines(
  routines: BrsRoutine[],
  publicNames: Set<string>,
): Map<string, string> {
  const byName = new Set(routines.map((r) => r.name.toLowerCase()));
  const map = new Map<string, string>();
  for (const routine of privateRoutineCandidates(routines, publicNames)) {
    const replacement = `_${routine.name}`;
    if (byName.has(replacement.toLowerCase())) continue;
    map.set(routine.name.toLowerCase(), replacement);
  }
  return map;
}

/**
 * Repair aliases left behind by an earlier or partial run. If a script already
 * declares `_helper` and no `helper` declaration exists, references to `helper`
 * are stale references to the private routine and should move to `_helper`.
 */
function computePrivateAliasRenames(
  routines: BrsRoutine[],
  publicNames: Set<string>,
): Map<string, string> {
  const byName = new Set(routines.map((r) => r.name.toLowerCase()));
  const map = new Map<string, string>();
  for (const routine of routines) {
    if (!routine.name.startsWith("_") || routine.name.length === 1) continue;
    const publicName = routine.name.slice(1);
    if (isFrameworkRoutine(publicName) || isNamespacedGlobal(publicName)) continue;
    if (publicNames.has(publicName.toLowerCase())) continue;
    if (byName.has(publicName.toLowerCase())) continue;
    map.set(publicName.toLowerCase(), routine.name);
  }
  return map;
}

function previousToken(tokens: BscToken[], index: number): BscToken | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const token = tokens[i]!;
    if (token.kind !== "Newline" && token.kind !== "Comment") return token;
  }
  return undefined;
}

function nextToken(tokens: BscToken[], index: number): BscToken | undefined {
  for (let i = index + 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.kind !== "Newline" && token.kind !== "Comment") return token;
  }
  return undefined;
}

function previousTokenIndex(tokens: BscToken[], index: number): number {
  for (let i = index - 1; i >= 0; i--) {
    const token = tokens[i]!;
    if (token.kind !== "Newline" && token.kind !== "Comment") return i;
  }
  return -1;
}

function nextTokenIndex(tokens: BscToken[], index: number): number {
  for (let i = index + 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.kind !== "Newline" && token.kind !== "Comment") return i;
  }
  return -1;
}

function stringLiteralValue(token: BscToken): string | null {
  const text = token.text;
  if (text.length < 2) return null;
  const quote = text[0];
  if ((quote !== '"' && quote !== "'") || text[text.length - 1] !== quote) {
    return null;
  }
  return text.slice(1, -1);
}

function isMIdentifier(token: BscToken | undefined): boolean {
  return token?.kind === "Identifier" && token.text.toLowerCase() === "m";
}

function mayHaveIndexedStringKey(source: string): boolean {
  return source.includes('["') || source.includes("['");
}

function isIndexedFunctionExportValue(
  tokens: BscToken[],
  index: number,
  replacement: string,
): boolean {
  const equal = previousTokenIndex(tokens, index);
  const right = equal >= 0 ? previousTokenIndex(tokens, equal) : -1;
  const keyIndex = right >= 0 ? previousTokenIndex(tokens, right) : -1;
  const left = keyIndex >= 0 ? previousTokenIndex(tokens, keyIndex) : -1;
  const receiver = left >= 0 ? previousTokenIndex(tokens, left) : -1;
  if (!isMIdentifier(tokens[receiver])) return false;
  if (tokens[left]?.kind !== "LeftSquareBracket") return false;
  const key = tokens[keyIndex];
  if (key?.kind !== "StringLiteral") return false;
  if (tokens[right]?.kind !== "RightSquareBracket") return false;
  if (tokens[equal]?.kind !== "Equal") return false;

  const keyValue = stringLiteralValue(key)?.toLowerCase();
  if (!keyValue) return false;
  return (
    keyValue === tokens[index]!.text.toLowerCase() ||
    keyValue === replacement.toLowerCase()
  );
}

function routineRenameEdits(
  ctx: BrsRuleContext,
  renames: Map<string, string>,
): Edit[] {
  const edits: Edit[] = observerHandlerStringEdits(ctx.source, renames);
  const mayHaveIndexedExport = mayHaveIndexedStringKey(ctx.source);

  for (let i = 0; i < ctx.parse.tokens.length; i++) {
    const token = ctx.parse.tokens[i]!;
    if (token.kind !== "Identifier" || !token.location) continue;
    const replacement = renames.get(token.text.toLowerCase());
    if (!replacement) continue;

    const previous = previousToken(ctx.parse.tokens, i);
    const next = nextToken(ctx.parse.tokens, i);
    const isDeclaration =
      previous?.kind === "Function" || previous?.kind === "Sub";
    const isBareCall = previous?.kind !== "Dot" && next?.kind === "LeftParen";
    if (isBareCall && isNativeGlobalCallException(token.text)) continue;

    const isIndexedExportValue =
      mayHaveIndexedExport &&
      isIndexedFunctionExportValue(ctx.parse.tokens, i, replacement);
    if (!isDeclaration && !isBareCall && !isIndexedExportValue) continue;

    const span = ctx.parse.lineIndex.rangeToSpan(token.location.range);
    edits.push({
      ruleId: RULE_ID,
      offset: span.offset,
      length: span.length,
      replacement,
    });
  }
  return edits;
}

function observerHandlerStringEdits(
  source: string,
  renames: Map<string, string>,
): Edit[] {
  const edits: Edit[] = [];
  const re =
    /\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\.observeField(?:Scoped)?\s*\(\s*["'][^"']+["']\s*,\s*(["'])([^"']+)\1/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const handler = match[2];
    if (!handler) continue;
    const replacement = renames.get(handler.toLowerCase());
    if (!replacement) continue;
    const offset = match.index + match[0].lastIndexOf(handler);
    edits.push({
      ruleId: RULE_ID,
      offset,
      length: handler.length,
      replacement,
    });
  }
  return edits;
}

function interfaceFunctionNameEdits(ctx: XmlRuleContext): {
  edits: Edit[];
  diagnostics: RuleResult["diagnostics"];
} {
  const diagnostics: RuleResult["diagnostics"] = [];
  const edits: Edit[] = [];
  if (!ctx.parse.root) return { edits, diagnostics };

  for (const el of walkElements(ctx.parse.root)) {
    if (!tagNameEquals(el, "interface")) continue;
    for (const child of el.children) {
      if (!tagNameEquals(child, "function")) continue;
      const nameAttr = child.attributes.find(
        (attr) => attr.name.toLowerCase() === "name",
      );
      if (!nameAttr) continue;
      const name = attrValue(child, "name");
      if (!name?.startsWith("_") || name.length === 1) continue;
      // The interface declares a `_`-prefixed (private-looking) routine. This is
      // an inconsistency, but we never auto-strip the `_` to make it public —
      // promoting a private routine to public is never a safe assumption. Report
      // it for a human to resolve.
      diagnostics.push({
        ruleId: RULE_ID,
        severity: ctx.severity,
        message:
          `Interface routine "${name}" carries a private "_" prefix; an ` +
          "interface function is public, so resolve this by hand (rename or " +
          "remove it from the interface) rather than auto-promoting it.",
        span: {
          offset: nameAttr.start,
          length: nameAttr.end - nameAttr.start,
        },
        fixable: false,
      });
    }
  }
  return { edits, diagnostics };
}


function isPrefixedAllCapsConstant(name: string): boolean {
  return /^_[A-Z][A-Z0-9_]*$/.test(name);
}

/**
 * ALL_CAPS members (with or without a leading `_`) are constants. They keep
 * their uppercase spelling; an unprefixed one only needs a private `_` prefix.
 */
function isAllCapsConstant(name: string): boolean {
  const core = name.startsWith("_") ? name.slice(1) : name;
  return /^[A-Z][A-Z0-9_]*$/.test(core);
}

function memberNamingMessage(name: string): string {
  if (isAllCapsConstant(name)) {
    return (
      `Member "m.${name}" is a private constant; keep its ALL_CAPS spelling ` +
      `and add a leading "_" (rename to "m._${name}").`
    );
  }
  return (
    `Member "m.${name}" should be lowerCamelCase ` +
    "(optionally _-prefixed for private members)."
  );
}

function memberTarget(name: string): string {
  if (isAllCapsConstant(name)) {
    return name.startsWith("_") ? name : `_${name}`;
  }

  const core = name.replace(/^_+/, "");
  return `_${lowerCamel(core)}`;
}

function lowerCamel(name: string): string {
  const acronym = name.match(/^[A-Z]+(?=[A-Z][a-z]|[0-9]|$)/)?.[0];
  if (acronym && acronym.length > 1) {
    return acronym.toLowerCase() + name.slice(acronym.length);
  }
  return name.length === 0 ? name : name[0]!.toLowerCase() + name.slice(1);
}

function collectMemberRenameTargets(source: string): {
  renames: Map<string, string>;
  collisions: Map<string, string>;
} {
  const memberNames = new Set<string>();
  for (const m of scan(source, /\bm\.([A-Za-z_][\w]*)/g)) {
    memberNames.add((m.groups[0] ?? "").toLowerCase());
  }

  const renames = new Map<string, string>();
  const collisions = new Map<string, string>();
  for (const m of scan(source, /\bm\.(_?[A-Z][\w]*)\s*=/g)) {
    const member = m.groups[0] ?? "";
    if (!member || isPrefixedAllCapsConstant(member)) continue;
    const target = memberTarget(member);
    const key = member.toLowerCase();
    const targetKey = target.toLowerCase();
    if (renames.has(key) || collisions.has(key)) continue;
    if (target === member) continue;
    if (targetKey !== key && memberNames.has(targetKey)) {
      collisions.set(key, target);
      continue;
    }
    renames.set(key, target);
  }
  return { renames, collisions };
}

function memberNamingDiagnostics(
  source: string,
  severity: BrsRuleContext["severity"],
  renames: Map<string, string>,
  collisions: Map<string, string>,
): RuleResult["diagnostics"] {
  const diagnostics: RuleResult["diagnostics"] = [];
  for (const m of scan(source, /\bm\.(_?[A-Z][\w]*)\s*=/g)) {
    const member = m.groups[0] ?? "";
    if (!member || isPrefixedAllCapsConstant(member)) continue;
    const key = member.toLowerCase();
    const target = renames.get(key) ?? collisions.get(key);
    const offset = m.offset + 2;

    if (collisions.has(key)) {
      diagnostics.push({
        ruleId: RULE_ID,
        severity,
        message:
          `${memberNamingMessage(member)} Cannot rename it to "m.${target}" ` +
          "because that member name already exists.",
        span: { offset, length: member.length },
        fixable: false,
      });
      continue;
    }

    diagnostics.push({
      ruleId: RULE_ID,
      severity,
      message: `${memberNamingMessage(member)} Rename it to "m.${target}".`,
      span: { offset, length: member.length },
      fixable: renames.has(key),
    });
  }
  return diagnostics;
}

function memberRenameEdits(
  ctx: BrsRuleContext,
  renames: Map<string, string>,
): Edit[] {
  if (renames.size === 0) return [];

  const sig = ctx.parse.tokens.filter(
    (t) => t.kind !== "Newline" && t.kind !== "Comment",
  );
  const edits: Edit[] = [];
  for (let i = 0; i < sig.length; i++) {
    const tok = sig[i]!;
    if (tok.kind !== "Identifier" || !tok.location) continue;
    const replacement = renames.get(tok.text.toLowerCase());
    if (!replacement) continue;
    if (sig[i - 1]?.kind !== "Dot") continue;
    const obj = sig[i - 2];
    if (!(obj?.kind === "Identifier" && obj.text.toLowerCase() === "m")) continue;
    if (sig[i - 3]?.kind === "Dot") continue;
    const span = ctx.parse.lineIndex.rangeToSpan(tok.location.range);
    edits.push({
      ruleId: RULE_ID,
      offset: span.offset,
      length: span.length,
      replacement,
    });
  }
  return edits;
}

/**
 * Private `m` members should be lowerCamelCase (optionally `_`-prefixed), or
 * `_`-prefixed ALL_CAPS constants. Flags `m.<name>` assignments where the
 * member name starts with an uppercase letter. ALL_CAPS names are treated as
 * constants: an unprefixed one keeps its uppercase spelling and is only asked
 * to gain a private `_` prefix (it is never down-cased to lowerCamelCase).
 *
 * In project mode, primary component scripts use `_` for routines not declared
 * in the component XML `<interface>`. Namespaced utility functions and
 * constructor-style functions that return associative-array interfaces stay
 * public because they are intended for cross-component callers.
 */
export const privateMemberNaming: BrsRule = {
  id: RULE_ID,
  lang: "brs",
  // Runs before brs/declaration-order (phase 1) so that a routine this rule
  // privatizes (e.g. setItemContent → _setItemContent) is re-sorted into the
  // correct cohort by declaration-order on the next phase.
  phase: 0,
  run(ctx: BrsRuleContext): RuleResult {
    const memberRenames = collectMemberRenameTargets(ctx.source);
    const diagnostics = memberNamingDiagnostics(
      ctx.source,
      ctx.severity,
      memberRenames.renames,
      memberRenames.collisions,
    );
    const memberEdits = memberRenameEdits(ctx, memberRenames.renames);

    const interfaceInfo = ctx.projectContext?.publicInterfaceInfo(ctx.filePath) ?? null;
    if (!interfaceInfo) {
      if (diagnostics.length === 0 && memberEdits.length === 0) {
        return emptyResult();
      }
      return { edits: memberEdits, diagnostics };
    }
    const { publicNames } = interfaceInfo;

    const routinesByName = new Map(
      ctx.parse.topLevelFunctions.map((routine) => [
        routine.name.toLowerCase(),
        routine,
      ]),
    );
    // A `_`-prefixed routine is private by the author's own marking. We never
    // strip the `_` to make it public, even when the XML interface happens to
    // declare a matching name — promoting a private routine to public is never a
    // safe assumption (see AbstractHTTPService._execute). Only the
    // private-prefixing direction below is applied.
    const renames = computePrivateAliasRenames(
      ctx.parse.topLevelFunctions,
      publicNames,
    );

    if (interfaceInfo.requiresPrivatePrefixes) {
      for (const routine of privateRoutineCandidates(
        ctx.parse.topLevelFunctions,
        publicNames,
      )) {
        const replacement = `_${routine.name}`;
        if (routinesByName.has(replacement.toLowerCase())) {
          diagnostics.push({
            ruleId: RULE_ID,
            severity: ctx.severity,
            message:
              `Routine "${routine.name}" is private because it is not declared ` +
              `in the component XML interface, but "${replacement}" already exists.`,
            span: routine.nameSpan,
            fixable: false,
          });
          continue;
        }

        renames.set(routine.name.toLowerCase(), replacement);
        diagnostics.push({
          ruleId: RULE_ID,
          severity: ctx.severity,
          message:
            `Routine "${routine.name}" is private because it is not declared ` +
            `in the component XML interface; rename it to "${replacement}".`,
          span: routine.nameSpan,
          fixable: true,
        });
      }
    }

    // A routine declared in a sibling component-local script can be *called*
    // from this file. When that sibling routine is privatized (in its own run),
    // the call sites here must be rewritten too, or the program breaks. Mirror
    // each sibling's rename decision onto this file's call sites by computing the
    // same map the sibling would, from the shared project snapshot.
    const scopeRenames = new Map(renames);
    for (const [scriptPath] of interfaceInfo.scopeSources) {
      const parsed = ctx.projectContext?.getBrsParse(scriptPath);
      if (!parsed || parsed.fatal) continue;
      for (const [from, to] of computePrivateAliasRenames(
        parsed.topLevelFunctions,
        publicNames,
      )) {
        if (!scopeRenames.has(from)) scopeRenames.set(from, to);
      }
      for (const [from, to] of computeRenamesForRoutines(
        parsed.topLevelFunctions,
        publicNames,
      )) {
        if (!scopeRenames.has(from)) scopeRenames.set(from, to);
      }
    }

    const routineEdits =
      scopeRenames.size > 0 ? routineRenameEdits(ctx, scopeRenames) : [];
    const edits = [...memberEdits, ...routineEdits];
    if (diagnostics.length === 0 && edits.length === 0) return emptyResult();
    return { edits, diagnostics };
  },
};

export const privateInterfaceFunctionNaming: XmlRule = {
  id: RULE_ID,
  lang: "xml",
  phase: 4,
  run(ctx: XmlRuleContext): RuleResult {
    const result = interfaceFunctionNameEdits(ctx);
    if (result.diagnostics.length === 0 && result.edits.length === 0) {
      return emptyResult();
    }
    return result;
  },
};
