import type { XmlElement } from "./xml.js";

/** Get an attribute's unquoted value, or undefined if absent. */
export function attrValue(
  el: XmlElement,
  name: string,
): string | undefined {
  const attr = el.attributes.find((a) => a.name === name);
  if (!attr) return undefined;
  return unquote(attr.rawValue);
}

export function unquote(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

/** Basename of a path-like string, without extension. */
export function baseNameNoExt(p: string): string {
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const base = slash >= 0 ? p.slice(slash + 1) : p;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

export function tagNameEquals(el: XmlElement, name: string): boolean {
  return el.name.toLowerCase() === name.toLowerCase();
}

/**
 * True if any inter-element gap between consecutive siblings contains an XML
 * comment. Reorder rules must refuse in this case: their slot-separator model
 * reuses separator text by destination position, which would re-attach a
 * leading comment to the wrong element after a reorder.
 */
export function separatorsHaveComments(
  source: string,
  elements: XmlElement[],
): boolean {
  for (let i = 1; i < elements.length; i++) {
    const gap = source.slice(elements[i - 1]!.end, elements[i]!.start);
    if (gap.includes("<!--")) return true;
  }
  return false;
}

/**
 * True if an XML comment sits in the leading gap immediately before `element`
 * within `parent` — i.e. a banner comment that a reorder would strand. The gap
 * runs from the end of `element`'s previous sibling (or, if it is the first
 * child, from `parent`'s start, whose open tag contains no comments) up to
 * `element`'s start.
 */
export function commentBeforeElement(
  source: string,
  parent: XmlElement,
  element: XmlElement,
): boolean {
  const idx = parent.children.indexOf(element);
  const gapStart =
    idx > 0 ? parent.children[idx - 1]!.end : parent.start;
  return source.slice(gapStart, element.start).includes("<!--");
}
