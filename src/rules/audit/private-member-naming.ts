import { basename, dirname, isAbsolute, resolve } from "node:path";
import { Lexer } from "brighterscript/dist/lexer/Lexer.js";
import { emptyResult, type RuleResult } from "../../edit/types.js";
import type { Edit } from "../../edit/types.js";
import { parseXml, walkElements, type XmlAttribute } from "../../parser/xml.js";
import type { BscToken, BrsRoutine } from "../../parser/brighterscript-adapter.js";
import { attrValue, tagNameEquals } from "../../parser/xml-helpers.js";
import { diag, scan } from "./scan.js";
import type { BrsRule, BrsRuleContext, XmlRule, XmlRuleContext } from "../rule.js";

const RULE_ID = "audit/private-member-naming";

function baseNameNoExt(filePath: string): string {
  const file = basename(filePath);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

function absolutePath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(filePath);
}

function packageRootFor(filePath: string): string | null {
  const normalized = filePath.replaceAll("\\", "/");
  for (const segment of ["/components/", "/source/"]) {
    const idx = normalized.lastIndexOf(segment);
    if (idx >= 0) return filePath.slice(0, idx);
  }
  return null;
}

function resolveUri(xmlPath: string, uri: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri) && !uri.toLowerCase().startsWith("pkg:/")) {
    return null;
  }
  if (uri.toLowerCase().startsWith("pkg:/")) {
    const root = packageRootFor(xmlPath);
    if (!root) return null;
    return resolve(root, uri.slice("pkg:/".length));
  }
  return resolve(dirname(xmlPath), uri);
}

function componentReferencesBrs(
  xmlPath: string,
  xmlSource: string,
  brsPath: string,
): boolean {
  const parse = parseXml(xmlSource);
  if (parse.fatal || !parse.root) return false;

  let hasScript = false;
  for (const el of walkElements(parse.root)) {
    if (!tagNameEquals(el, "script")) continue;
    hasScript = true;
    const uri = attrValue(el, "uri");
    if (!uri) continue;
    const target = resolveUri(xmlPath, uri);
    if (!target || !/\.(brs|bs)$/i.test(target)) continue;
    if (absolutePath(target) === brsPath) return true;
  }

  if (hasScript) return false;
  const sibling = resolve(dirname(xmlPath), `${baseNameNoExt(xmlPath)}.brs`);
  return absolutePath(sibling) === brsPath;
}

interface ComponentInfo {
  name: string;
  extendsName: string | null;
  publicNames: Set<string>;
}

function parseComponentInfo(xmlSource: string): ComponentInfo | null {
  const parse = parseXml(xmlSource);
  if (parse.fatal || !parse.root) return null;

  const name = attrValue(parse.root, "name");
  if (!name) return null;
  return {
    name,
    extendsName: attrValue(parse.root, "extends") ?? null,
    publicNames: collectOwnInterfaceFunctions(xmlSource),
  };
}

function collectOwnInterfaceFunctions(xmlSource: string): Set<string> {
  const parse = parseXml(xmlSource);
  const names = new Set<string>();
  if (parse.fatal || !parse.root) return names;

  for (const el of walkElements(parse.root)) {
    if (!tagNameEquals(el, "interface")) continue;
    for (const child of el.children) {
      if (!tagNameEquals(child, "function")) continue;
      const name = attrValue(child, "name");
      if (name) names.add(publicRoutineKey(name));
    }
  }
  return names;
}

function componentIndex(
  sources: ReadonlyMap<string, string>,
): Map<string, ComponentInfo> {
  const index = new Map<string, ComponentInfo>();
  for (const [filePath, source] of sources) {
    if (!/\.xml$/i.test(filePath)) continue;
    const info = parseComponentInfo(source);
    if (!info) continue;
    index.set(info.name.toLowerCase(), info);
  }
  return index;
}

function collectInterfaceFunctions(
  xmlSource: string,
  index: Map<string, ComponentInfo>,
): Set<string> {
  const names = new Set<string>();
  const seen = new Set<string>();
  let info = parseComponentInfo(xmlSource);

  while (info) {
    const key = info.name.toLowerCase();
    if (seen.has(key)) break;
    seen.add(key);

    for (const name of info.publicNames) names.add(name);
    if (!info.extendsName) break;
    info = index.get(info.extendsName.toLowerCase()) ?? null;
  }

  return names;
}

function primaryComponentScript(xmlPath: string, brsPath: string): boolean {
  return (
    dirname(xmlPath) === dirname(brsPath) &&
    baseNameNoExt(xmlPath).toLowerCase() ===
    baseNameNoExt(brsPath).toLowerCase()
  );
}

function publicInterfaceInfo(ctx: BrsRuleContext): {
  publicNames: Set<string>;
  requiresPrivatePrefixes: boolean;
} | null {
  const sources = ctx.projectSources;
  if (!sources) return null;

  const brsPath = absolutePath(ctx.filePath);
  const names = new Set<string>();
  let foundComponent = false;
  let requiresPrivatePrefixes = false;
  const components = componentIndex(sources);
  for (const [filePath, source] of sources) {
    if (!/\.xml$/i.test(filePath)) continue;
    const xmlPath = absolutePath(filePath);
    if (!componentReferencesBrs(xmlPath, source, brsPath)) continue;
    foundComponent = true;
    if (primaryComponentScript(xmlPath, brsPath)) requiresPrivatePrefixes = true;
    for (const name of collectInterfaceFunctions(source, components)) {
      names.add(name);
    }
  }
  return foundComponent ? { publicNames: names, requiresPrivatePrefixes } : null;
}

function isFrameworkRoutine(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "init" || lower === "onkeyevent";
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
      !publicNames.has(publicRoutineKey(routine.name)),
  );
}

function prefixedPublicRoutineCandidates(
  routines: BrsRoutine[],
  publicNames: Set<string>,
): BrsRoutine[] {
  return routines.filter(
    (routine) =>
      routine.name.startsWith("_") &&
      routine.name.length > 1 &&
      publicNames.has(publicRoutineKey(routine.name)),
  );
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

function routineRenameEdits(
  ctx: BrsRuleContext,
  renames: Map<string, string>,
): Edit[] {
  const lex = Lexer.scan(ctx.source);
  if (lex.diagnostics.length > 0) return [];

  const edits: Edit[] = observerHandlerStringEdits(ctx.source, renames);
  for (let i = 0; i < lex.tokens.length; i++) {
    const token = lex.tokens[i] as BscToken;
    const replacement = renames.get(token.text.toLowerCase());
    if (!replacement || token.kind !== "Identifier" || !token.location) continue;

    const previous = previousToken(lex.tokens as BscToken[], i);
    const next = nextToken(lex.tokens as BscToken[], i);
    const isDeclaration =
      previous?.kind === "Function" || previous?.kind === "Sub";
    const isBareCall = previous?.kind !== "Dot" && next?.kind === "LeftParen";
    if (!isDeclaration && !isBareCall) continue;

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
      const edit = interfaceNameEdit(ctx.source, nameAttr, name.slice(1));
      if (!edit) continue;
      diagnostics.push({
        ruleId: RULE_ID,
        severity: ctx.severity,
        message:
          `Interface routine "${name}" is public and should be named ` +
          `"${name.slice(1)}" without a private "_" prefix.`,
        span: {
          offset: edit.offset,
          length: name.length,
        },
        fixable: true,
      });
      edits.push(edit);
    }
  }
  return { edits, diagnostics };
}

function interfaceNameEdit(
  source: string,
  attr: XmlAttribute,
  replacementName: string,
): Edit | null {
  const rawValueStart = source.indexOf(attr.rawValue, attr.start);
  if (rawValueStart < 0) return null;
  const quote = attr.rawValue[0];
  const valueStart =
    quote === '"' || quote === "'" ? rawValueStart + 1 : rawValueStart;
  return {
    ruleId: RULE_ID,
    offset: valueStart,
    length: 1 + replacementName.length,
    replacement: replacementName,
  };
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

/**
 * Private `m` members should be lowerCamelCase (optionally `_`-prefixed), or
 * `_`-prefixed ALL_CAPS constants. Flags `m.<name>` assignments where the
 * member name starts with an uppercase letter. ALL_CAPS names are treated as
 * constants: an unprefixed one keeps its uppercase spelling and is only asked
 * to gain a private `_` prefix (it is never down-cased to lowerCamelCase).
 *
 * In project mode, primary component scripts use `_` for routines not declared
 * in the component XML `<interface>`. Extra linked utility scripts are left
 * public unless the XML explicitly declares their routine in `<interface>`.
 */
export const privateMemberNaming: BrsRule = {
  id: RULE_ID,
  lang: "brs",
  phase: 4,
  run(ctx: BrsRuleContext): RuleResult {
    const re = /\bm\.(_?[A-Z][\w]*)\s*=/g;
    const diagnostics = scan(ctx.source, re)
      .filter((m) => !isPrefixedAllCapsConstant(m.groups[0]!))
      .map((m) =>
        diag(
          RULE_ID,
          ctx.severity,
          memberNamingMessage(m.groups[0]!),
          m.offset,
          m.length,
        ),
      );

    const interfaceInfo = publicInterfaceInfo(ctx);
    if (!interfaceInfo) {
      if (diagnostics.length === 0) return emptyResult();
      return { edits: [], diagnostics };
    }
    const { publicNames } = interfaceInfo;

    const routinesByName = new Map(
      ctx.parse.topLevelFunctions.map((routine) => [
        routine.name.toLowerCase(),
        routine,
      ]),
    );
    const renames = new Map<string, string>();
    for (const routine of prefixedPublicRoutineCandidates(
      ctx.parse.topLevelFunctions,
      publicNames,
    )) {
      const replacement = routine.name.slice(1);
      if (routinesByName.has(replacement.toLowerCase())) {
        diagnostics.push({
          ruleId: RULE_ID,
          severity: ctx.severity,
          message:
            `Routine "${routine.name}" is public because it is declared ` +
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
          `Routine "${routine.name}" is public because it is declared ` +
          `in the component XML interface; rename it to "${replacement}".`,
        span: routine.nameSpan,
        fixable: true,
      });
    }

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

    const edits = renames.size > 0 ? routineRenameEdits(ctx, renames) : [];
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
