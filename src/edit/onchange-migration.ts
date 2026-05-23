import { basename, dirname, resolve } from "node:path";
import { Lexer } from "brighterscript/dist/lexer/Lexer.js";
import { applyEdits } from "./apply.js";
import type { Edit } from "./types.js";
import {
  parseBrs,
  type BscToken,
  type BrsRoutine,
} from "../parser/brighterscript-adapter.js";
import { parseXml, walkElements, type XmlAttribute } from "../parser/xml.js";
import {
  attrValue,
  tagNameEquals,
  unquote,
} from "../parser/xml-helpers.js";
import { setterHandlerName } from "../util/observer-handler.js";

const RULE_ID = "xml/no-onchange-field";

interface OnChangeField {
  fieldId: string;
  handler: string;
  targetHandler: string;
  attr: XmlAttribute;
}

interface XmlMigration {
  xmlPath: string;
  brsPath: string;
  fields: OnChangeField[];
}

export interface OnChangeMigrationResult {
  sources: Map<string, string>;
  changedRuleIdsByFile: Map<string, Set<string>>;
}

function markChanged(
  changed: Map<string, Set<string>>,
  filePath: string,
): void {
  let ruleIds = changed.get(filePath);
  if (!ruleIds) {
    ruleIds = new Set<string>();
    changed.set(filePath, ruleIds);
  }
  ruleIds.add(RULE_ID);
}

function baseNameNoExt(filePath: string): string {
  const file = basename(filePath);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
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

function collectOnChangeFields(source: string): OnChangeField[] | null {
  const parse = parseXml(source);
  if (parse.fatal || !parse.root) return null;

  const fields: OnChangeField[] = [];
  for (const el of walkElements(parse.root)) {
    if (!tagNameEquals(el, "field")) continue;
    const onChange = el.attributes.find(
      (a) => a.name.toLowerCase() === "onchange",
    );
    if (!onChange) continue;
    const fieldId = attrValue(el, "id");
    if (!fieldId) continue;
    fields.push({
      fieldId,
      handler: unquote(onChange.rawValue),
      targetHandler: setterHandlerName(fieldId),
      attr: onChange,
    });
  }
  return fields;
}

function findScriptTarget(
  xmlPath: string,
  xmlSource: string,
  sources: Map<string, string>,
): string | null {
  const parse = parseXml(xmlSource);
  if (parse.fatal || !parse.root) return null;

  const xmlBase = baseNameNoExt(xmlPath).toLowerCase();
  const candidates: string[] = [];
  for (const el of walkElements(parse.root)) {
    if (!tagNameEquals(el, "script")) continue;
    const uri = attrValue(el, "uri");
    if (!uri) continue;
    const target = resolveUri(xmlPath, uri);
    if (!target) continue;
    if (!/\.(brs|bs)$/i.test(target)) continue;
    if (sources.has(target)) candidates.push(target);
  }

  const matchingBase = candidates.filter(
    (candidate) => baseNameNoExt(candidate).toLowerCase() === xmlBase,
  );
  if (matchingBase.length === 1) return matchingBase[0]!;
  if (candidates.length === 1) return candidates[0]!;

  const sibling = resolve(dirname(xmlPath), `${baseNameNoExt(xmlPath)}.brs`);
  if (sources.has(sibling)) return sibling;

  return null;
}

function wholeAttributeRemoval(source: string, attr: XmlAttribute): Edit {
  const lineStart = source.lastIndexOf("\n", attr.start - 1) + 1;
  const lineEndIdx = source.indexOf("\n", attr.end);
  const lineEnd = lineEndIdx >= 0 ? lineEndIdx : source.length;
  const beforeOnLine = source.slice(lineStart, attr.start);
  const afterOnLine = source.slice(attr.end, lineEnd);

  if (beforeOnLine.trim() === "" && afterOnLine.trim() === "") {
    const end = lineEndIdx >= 0 ? lineEndIdx + 1 : lineEnd;
    return {
      ruleId: RULE_ID,
      offset: lineStart,
      length: end - lineStart,
      replacement: "",
    };
  }

  let start = attr.start;
  while (start > lineStart && /[ \t]/.test(source[start - 1]!)) start--;
  return {
    ruleId: RULE_ID,
    offset: start,
    length: attr.end - start,
    replacement: "",
  };
}

function lineEndIncludingNewline(source: string, offset: number): number {
  const newline = source.indexOf("\n", offset);
  return newline >= 0 ? newline + 1 : source.length;
}

function bodyIndent(source: string, init: BrsRoutine): string {
  const bodyStart = lineEndIncludingNewline(source, init.keywordSpan.offset);
  const body = source.slice(bodyStart, init.declSpan.offset + init.declSpan.length);
  for (const line of body.split(/\r?\n/)) {
    if (line.trim() === "" || /^end\s+(sub|function)\b/i.test(line.trim())) {
      continue;
    }
    const match = line.match(/^\s*/);
    if (match) return match[0];
  }
  return "    ";
}

function hasObserverForField(source: string, fieldId: string): boolean {
  const escapedField = fieldId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    String.raw`\bm\.top\.observeField(?:Scoped)?\s*\(\s*["']${escapedField}["']\s*,`,
    "i",
  ).test(source);
}

function missingObserverFields(
  source: string,
  fields: OnChangeField[],
): OnChangeField[] {
  return fields.filter((field) => !hasObserverForField(source, field.fieldId));
}

function observerEdit(
  source: string,
  missing: OnChangeField[],
): Edit | null {
  const parse = parseBrs(source, "component.brs");
  if (parse.fatal) return null;
  const init = parse.topLevelFunctions.find(
    (routine) => routine.name.toLowerCase() === "init",
  );
  if (!init) return null;
  if (missing.length === 0) return null;

  const insertAt = lineEndIncludingNewline(source, init.keywordSpan.offset);
  const indent = bodyIndent(source, init);
  const replacement = missing
    .map(
      (field) =>
        `${indent}m.top.observeFieldScoped("${field.fieldId}", "${field.targetHandler}")\n`,
    )
    .join("");
  return {
    ruleId: RULE_ID,
    offset: insertAt,
    length: 0,
    replacement,
  };
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
  source: string,
  parse: ReturnType<typeof parseBrs>,
  fields: OnChangeField[],
): Edit[] {
  const routinesByName = new Map(
    parse.topLevelFunctions.map((routine) => [
      routine.name.toLowerCase(),
      routine,
    ]),
  );
  const renames = new Map<string, string>();
  for (const field of fields) {
    if (field.handler === field.targetHandler) continue;
    const oldKey = field.handler.toLowerCase();
    if (!routinesByName.has(oldKey)) continue;
    if (routinesByName.has(field.targetHandler.toLowerCase())) continue;
    const existing = renames.get(oldKey);
    if (existing && existing !== field.targetHandler) continue;
    renames.set(oldKey, field.targetHandler);
  }
  if (renames.size === 0) return [];

  const lex = Lexer.scan(source);
  if (lex.diagnostics.length > 0) return [];

  const edits: Edit[] = [];
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

    const span = parse.lineIndex.rangeToSpan(token.location.range);
    edits.push({
      ruleId: RULE_ID,
      offset: span.offset,
      length: span.length,
      replacement,
    });
  }
  return edits;
}

export function migrateOnChangeObservers(
  sources: Map<string, string>,
): OnChangeMigrationResult {
  const nextSources = new Map(sources);
  const changedRuleIdsByFile = new Map<string, Set<string>>();
  const migrations: XmlMigration[] = [];

  for (const [filePath, source] of sources) {
    if (!/\.xml$/i.test(filePath)) continue;
    const fields = collectOnChangeFields(source);
    if (!fields || fields.length === 0) continue;
    const brsPath = findScriptTarget(filePath, source, sources);
    if (!brsPath) continue;
    const brsSource = sources.get(brsPath);
    if (!brsSource) continue;
    const brsParse = parseBrs(brsSource, brsPath);
    if (brsParse.fatal) continue;
    if (!brsParse.topLevelFunctions.some(
      (routine) => routine.name.toLowerCase() === "init",
    )) {
      continue;
    }
    migrations.push({ xmlPath: filePath, brsPath, fields });
  }

  const fieldsByBrs = new Map<string, OnChangeField[]>();
  for (const migration of migrations) {
    const xmlSource = nextSources.get(migration.xmlPath);
    if (!xmlSource) continue;
    const edits = migration.fields.map((field) =>
      wholeAttributeRemoval(xmlSource, field.attr),
    );
    const xmlOutput = applyEdits(xmlSource, edits);
    if (xmlOutput !== xmlSource) {
      nextSources.set(migration.xmlPath, xmlOutput);
      markChanged(changedRuleIdsByFile, migration.xmlPath);
    }

    const fields = fieldsByBrs.get(migration.brsPath) ?? [];
    fields.push(...migration.fields);
    fieldsByBrs.set(migration.brsPath, fields);
  }

  for (const [brsPath, fields] of fieldsByBrs) {
    const brsSource = nextSources.get(brsPath);
    if (!brsSource) continue;
    const parse = parseBrs(brsSource, brsPath);
    if (parse.fatal) continue;
    const missing = missingObserverFields(brsSource, fields);
    const edits = [
      ...routineRenameEdits(brsSource, parse, missing),
      ...[observerEdit(brsSource, missing)].filter((e): e is Edit => e !== null),
    ];
    if (edits.length === 0) continue;
    const brsOutput = applyEdits(brsSource, edits);
    if (brsOutput !== brsSource) {
      nextSources.set(brsPath, brsOutput);
      markChanged(changedRuleIdsByFile, brsPath);
    }
  }

  return { sources: nextSources, changedRuleIdsByFile };
}
