import { basename, dirname, isAbsolute, resolve } from "node:path";
import { Lexer } from "brighterscript/dist/lexer/Lexer.js";
import { emptyResult, type RuleResult } from "../../edit/types.js";
import type { Edit } from "../../edit/types.js";
import { parseXml, walkElements } from "../../parser/xml.js";
import { parseBrs } from "../../parser/brighterscript-adapter.js";
import type { BscToken, BrsRoutine } from "../../parser/brighterscript-adapter.js";
import { attrValue, tagNameEquals } from "../../parser/xml-helpers.js";
import { scan } from "./scan.js";
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

/**
 * Absolute paths of every component-local script a component links — the
 * `.brs`/`.bs` files it references that live in the same directory as its XML.
 * These form the component's script scope: routines declared in any of them are
 * callable from all the others, so a rename in one must be reflected as a
 * call-site update in the rest. Shared utilities linked from another directory
 * (pkg:/.../utils, ../common) are excluded — they are not component-private.
 */
function collectScopeScripts(xmlPath: string, xmlSource: string): string[] {
  const parse = parseXml(xmlSource);
  if (parse.fatal || !parse.root) return [];
  const dir = dirname(xmlPath);
  const out: string[] = [];
  let hasScript = false;
  for (const el of walkElements(parse.root)) {
    if (!tagNameEquals(el, "script")) continue;
    hasScript = true;
    const uri = attrValue(el, "uri");
    if (!uri) continue;
    const target = resolveUri(xmlPath, uri);
    if (!target || !/\.(brs|bs)$/i.test(target)) continue;
    const abs = absolutePath(target);
    if (dirname(abs) === dir) out.push(abs);
  }
  if (!hasScript) {
    out.push(absolutePath(resolve(dir, `${baseNameNoExt(xmlPath)}.brs`)));
  }
  return out;
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

function publicInterfaceInfo(ctx: BrsRuleContext): {
  publicNames: Set<string>;
  requiresPrivatePrefixes: boolean;
  /** Other component-local scripts in this file's scope: abs path → source. */
  scopeSources: Map<string, string>;
} | null {
  const sources = ctx.projectSources;
  if (!sources) return null;

  const brsPath = absolutePath(ctx.filePath);
  const sourceByAbs = new Map<string, string>();
  for (const [filePath, source] of sources) {
    if (/\.(brs|bs)$/i.test(filePath)) sourceByAbs.set(absolutePath(filePath), source);
  }

  const names = new Set<string>();
  let foundComponent = false;
  let requiresPrivatePrefixes = false;
  const scopeSources = new Map<string, string>();
  const components = componentIndex(sources);
  for (const [filePath, source] of sources) {
    if (!/\.xml$/i.test(filePath)) continue;
    const xmlPath = absolutePath(filePath);
    if (!componentReferencesBrs(xmlPath, source, brsPath)) continue;
    foundComponent = true;
    // Any script the component links that lives in the same directory is a
    // component-local script (e.g. LIVEPlayer.brs, LIVEPlayercallbacks.brs,
    // LIVEPlayertracking.brs all next to LIVEPlayer.xml), so its routines must
    // be private unless declared in the interface. Only shared utilities
    // referenced from another directory (pkg:/.../utils, ../common) keep public
    // helper names.
    if (dirname(xmlPath) === dirname(brsPath)) requiresPrivatePrefixes = true;
    for (const name of collectInterfaceFunctions(source, components)) {
      names.add(name);
    }
    // Gather sibling scripts in the same scope so call sites in THIS file that
    // target a now-private sibling routine are rewritten in the same pass.
    for (const scriptPath of collectScopeScripts(xmlPath, source)) {
      if (scriptPath === brsPath) continue;
      const siblingSource = sourceByAbs.get(scriptPath);
      if (siblingSource !== undefined) scopeSources.set(scriptPath, siblingSource);
    }
  }
  return foundComponent
    ? { publicNames: names, requiresPrivatePrefixes, scopeSources }
    : null;
}

function isFrameworkRoutine(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "init" || lower === "onkeyevent";
}

/**
 * Namespaced global helpers follow the `Namespace_method` convention
 * (`StringUtil_trim`, `HTTPUtil_addQueryParams`, `DeviceUtil_getId`). They are
 * shared, globally-scoped functions called from many components, never
 * component-private members, so they are exempt from private-prefixing even when
 * they live in a component's directory.
 */
function isNamespacedGlobal(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9]*_[A-Za-z]/.test(name);
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
  const lex = Lexer.scan(ctx.source);
  if (lex.diagnostics.length > 0) return [];

  const sig = (lex.tokens as BscToken[]).filter(
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
 * in the component XML `<interface>`. Extra linked utility scripts are left
 * public unless the XML explicitly declares their routine in `<interface>`.
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

    const interfaceInfo = publicInterfaceInfo(ctx);
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
    const renames = new Map<string, string>();

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
    for (const [scriptPath, scriptSource] of interfaceInfo.scopeSources) {
      const parsed = parseBrs(scriptSource, scriptPath);
      if (parsed.fatal) continue;
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
