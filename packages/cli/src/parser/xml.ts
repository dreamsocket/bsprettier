/**
 * XML CST adapter. Wraps `@xml-tools/parser` and exposes a simplified element
 * tree with absolute source offsets. No DOM serialization — rules splice the
 * original source so trivia outside edited regions survives byte-for-byte.
 */
import { parse as parseXmlCst } from "@xml-tools/parser";
import { formatMetrics } from "./metrics.js";

export interface XmlAttribute {
  name: string;
  /** Raw value image including surrounding quotes (or empty if malformed). */
  rawValue: string;
  /** Absolute span of the whole `name="value"` attribute. */
  start: number;
  end: number;
}

export interface XmlElement {
  name: string;
  attributes: XmlAttribute[];
  children: XmlElement[];
  /** Absolute span of the entire element. */
  start: number;
  end: number;
  /**
   * Absolute span covering all attributes: from the first attribute start to
   * the last attribute end. Null when the element has no attributes.
   */
  attributesStart: number | null;
  attributesEnd: number | null;
  selfClosing: boolean;
  parent: XmlElement | null;
}

export interface XmlParseResult {
  source: string;
  root: XmlElement | null;
  fatal: boolean;
  errors: string[];
}

interface CstToken {
  image: string;
  startOffset: number;
  endOffset: number;
}

interface CstNode {
  name: string;
  children: Record<string, (CstNode | CstToken)[]>;
  location?: { startOffset: number; endOffset: number };
}

function isToken(n: CstNode | CstToken): n is CstToken {
  return (n as CstToken).image !== undefined;
}

function firstToken(node: CstNode, key: string): CstToken | undefined {
  const arr = node.children[key];
  if (!arr || arr.length === 0) return undefined;
  const c = arr[0]!;
  return isToken(c) ? c : undefined;
}

function buildAttribute(node: CstNode): XmlAttribute {
  const nameTok = firstToken(node, "Name");
  const stringTok = firstToken(node, "STRING");
  const start = node.location!.startOffset;
  const end = node.location!.endOffset + 1;
  return {
    name: nameTok?.image ?? "",
    rawValue: stringTok?.image ?? "",
    start,
    end,
  };
}

function buildElement(node: CstNode, parent: XmlElement | null): XmlElement {
  const nameTok = firstToken(node, "Name");
  const attrNodes = (node.children.attribute ?? []).filter(
    (n): n is CstNode => !isToken(n),
  );
  const attributes = attrNodes.map(buildAttribute);
  const selfClosing = (node.children.SLASH_CLOSE ?? []).length > 0;
  const start = node.location!.startOffset;
  const end = node.location!.endOffset + 1;

  const el: XmlElement = {
    name: nameTok?.image ?? "",
    attributes,
    children: [],
    start,
    end,
    attributesStart: attributes.length > 0 ? attributes[0]!.start : null,
    attributesEnd:
      attributes.length > 0 ? attributes[attributes.length - 1]!.end : null,
    selfClosing,
    parent,
  };

  const content = (node.children.content ?? []).filter(
    (n): n is CstNode => !isToken(n),
  );
  for (const c of content) {
    const childEls = (c.children.element ?? []).filter(
      (n): n is CstNode => !isToken(n),
    );
    for (const ce of childEls) {
      el.children.push(buildElement(ce, el));
    }
  }
  return el;
}

export function parseXml(source: string): XmlParseResult {
  if (!formatMetrics.enabled) return parseXmlImpl(source);
  const t0 = performance.now();
  const result = parseXmlImpl(source);
  formatMetrics.xmlCount++;
  formatMetrics.xmlMs += performance.now() - t0;
  return result;
}

function parseXmlImpl(source: string): XmlParseResult {
  let cst: CstNode;
  let lexErrors: unknown[];
  let parseErrors: unknown[];
  try {
    const res = parseXmlCst(source);
    cst = res.cst as unknown as CstNode;
    lexErrors = res.lexErrors;
    parseErrors = res.parseErrors;
  } catch (err) {
    return {
      source,
      root: null,
      fatal: true,
      errors: [String(err)],
    };
  }

  const errors = [
    ...lexErrors.map((e: any) => e.message ?? String(e)),
    ...parseErrors.map((e: any) => e.message ?? String(e)),
  ];
  const fatal = errors.length > 0;

  const rootCst = (cst.children.element ?? []).filter(
    (n): n is CstNode => !isToken(n),
  )[0];
  const root = rootCst ? buildElement(rootCst, null) : null;

  return { source, root, fatal, errors };
}

/** Depth-first iteration over an element and its descendants. */
export function* walkElements(el: XmlElement): Generator<XmlElement> {
  yield el;
  for (const child of el.children) {
    yield* walkElements(child);
  }
}
