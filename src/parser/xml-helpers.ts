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
 * Comments that label a whole interface/script SECTION (Events/Properties/
 * Functions and friends) rather than the single member directly below them.
 * Attaching one of these to a member and moving it during a reorder would
 * misplace the label, so Tier-1 comment-ownership refuses when one is present.
 * Matched only when the comment STARTS with the section word, so item comments
 * like `Exposed functions for the nav stack` are not treated as headers.
 */
const SECTION_HEADER_RE =
  /^(events?|propert(?:y|ies)|props?|functions?|methods?|nethods?|fields?|getters?|setters?|read[\s-]*only|operations?|method\s*\/\s*event)\b/i;

/** True if a `<!-- ... -->` comment image reads as a section header. */
export function isSectionHeaderComment(commentImage: string): boolean {
  const inner = commentImage
    .replace(/^<!--/, "")
    .replace(/-->$/, "")
    .trim();
  return SECTION_HEADER_RE.test(inner);
}

interface CommentSpan {
  start: number;
  end: number;
}

/** Find all `<!-- ... -->` comment spans within `[from, to)`. */
function findComments(source: string, from: number, to: number): CommentSpan[] {
  const out: CommentSpan[] = [];
  let i = from;
  while (i < to) {
    const open = source.indexOf("<!--", i);
    if (open < 0 || open >= to) break;
    const close = source.indexOf("-->", open + 4);
    const end = close < 0 ? to : Math.min(close + 3, to);
    out.push({ start: open, end });
    i = end;
  }
  return out;
}

function newlineCount(s: string): number {
  let n = 0;
  for (const ch of s) if (ch === "\n") n++;
  return n;
}

/** Offset of the start of the line containing `offset` (just after a newline). */
function lineStart(source: string, offset: number): number {
  let i = offset;
  while (i > 0 && source[i - 1] !== "\n") i--;
  return i;
}

/** Layout of one reorderable member plus the comments that move with it. */
export interface MemberLayout {
  /**
   * Start of the movable text: indentation + attached leading item comments +
   * element. Section-header comments are excluded — they stay in the gap as a
   * fixed run boundary so a reorder never drags a section label around with one
   * member.
   */
  ownStart: number;
  /**
   * End of the movable text: the element end, extended to cover a trailing
   * comment that sits on the same line as the element (or on the lines
   * immediately below it, with no blank line between) so it travels with the
   * member it trails.
   */
  end: number;
  /** True if a section-header comment sits in this member's leading gap. */
  hasLeadingHeader: boolean;
}

export interface ReorderLayout {
  members: MemberLayout[];
  /**
   * True if a comment can't be cleanly attributed — a floating comment with a
   * blank line on both sides, between two members. Callers refuse to reorder.
   */
  unsafe: boolean;
}

/**
 * Compute, for a run of sibling `elements`, which comments travel with which
 * member when reordered:
 *
 * - A leading item comment on its own line directly above a member (a blank
 *   line above it is fine, but none between it and the member) is that member's
 *   — it moves with it.
 * - A trailing comment on the same line as a member, or on the lines directly
 *   below it with no blank line separating them, belongs to that member and
 *   moves with it.
 * - A section-header comment is left in the gap and only flagged via
 *   `hasLeadingHeader`, so callers can treat it as a fixed run boundary.
 * - A comment with a blank line on both sides, stranded between two members,
 *   can't be attributed and sets `unsafe`.
 *
 * The structural whitespace (and any headers) between members stay in fixed
 * slots, preserving the existing blank-line pattern. `lowerBound` is the offset
 * the leading scan must not cross (the parent's open-tag end or the previous
 * sibling's end); `upperBound` bounds the last member's trailing scan (the
 * parent's close-tag start or the next sibling's start).
 */
export function computeReorderLayout(
  source: string,
  elements: XmlElement[],
  lowerBound: number,
  upperBound: number,
): ReorderLayout {
  const members: MemberLayout[] = [];
  let unsafe = false;
  const isHeader = (c: CommentSpan) =>
    isSectionHeaderComment(source.slice(c.start, c.end));

  /** Extend `member.end` over trailing comments adjacent to it within `limit`. */
  const attachTrailing = (member: MemberLayout, fromEnd: number, limit: number) => {
    const comments = findComments(source, fromEnd, limit);
    for (let i = 0; i < comments.length; i++) {
      const cm = comments[i]!;
      const before = source.slice(i === 0 ? fromEnd : comments[i - 1]!.end, cm.start);
      // Same line as the element, or a line directly below with no blank line.
      if (before.trim() !== "" || newlineCount(before) > 1) break;
      if (isHeader(cm)) break; // section header → boundary, never a trailer
      // A trailer must end its line. If the next element/comment is glued to it
      // with no newline between, it's a leading-inline comment, not a trailer.
      const after = source.slice(cm.end, i + 1 < comments.length ? comments[i + 1]!.start : limit);
      if (newlineCount(after) < 1) break;
      member.end = cm.end;
    }
  };

  for (let k = 0; k < elements.length; k++) {
    const el = elements[k]!;
    const gapStart = k === 0 ? lowerBound : elements[k - 1]!.end;
    const comments = findComments(source, gapStart, el.start);

    // Attach own-line, adjacent, NON-header leading comments (nearest first).
    const attached: CommentSpan[] = [];
    let nextStart = el.start;
    let idx = comments.length - 1;
    for (; idx >= 0; idx--) {
      const cm = comments[idx]!;
      const after = source.slice(cm.end, nextStart);
      // Adjacent to the member/next-comment, on its own line, no blank line.
      if (after.trim() !== "" || newlineCount(after) !== 1) break;
      const prevEnd = idx > 0 ? comments[idx - 1]!.end : gapStart;
      const before = source.slice(prevEnd, cm.start);
      // The comment must begin its own line (not trail prior content).
      if (before.trim() !== "" || newlineCount(before) < 1) break;
      if (isHeader(cm)) break; // section header → run boundary, not attached
      attached.unshift(cm);
      nextStart = cm.start;
    }

    // Comments[0..idx] are not leading for this member. Give the ones adjacent
    // to the previous member to it as trailers; classify the rest.
    let firstUnclaimed = 0;
    if (k > 0) {
      const prev = members[k - 1]!;
      attachTrailing(prev, elements[k - 1]!.end, el.start);
      // Skip the comments attachTrailing just consumed (those before prev.end).
      while (firstUnclaimed <= idx && comments[firstUnclaimed]!.end <= prev.end) {
        firstUnclaimed++;
      }
    }

    // Whatever sits between the previous member's trailers and this member's
    // leaders: section headers are run boundaries; a non-header comment stranded
    // here (blank line on both sides) can't be attributed. Comments before the
    // first member live in the fixed pre-region and are left untouched.
    let hasLeadingHeader = false;
    for (let c = firstUnclaimed; c <= idx; c++) {
      if (isHeader(comments[c]!)) hasLeadingHeader = true;
      else if (k > 0) unsafe = true;
    }

    const firstUnit = attached.length > 0 ? attached[0]!.start : el.start;
    members.push({
      ownStart: lineStart(source, firstUnit),
      end: el.end,
      hasLeadingHeader,
    });
  }

  // The last member's trailing comment lives after it, before the close tag.
  if (members.length > 0) {
    const last = members[members.length - 1]!;
    attachTrailing(last, elements[elements.length - 1]!.end, upperBound);
  }

  return { members, unsafe };
}

/**
 * Lower bound for scanning leading comments before `firstChild`: the end of the
 * nearest preceding sibling, or the parent's open-tag end if it is first.
 */
export function reorderLowerBound(
  source: string,
  parent: XmlElement,
  firstChild: XmlElement,
): number {
  let lb = source.indexOf(">", parent.start) + 1;
  for (const c of parent.children) {
    if (c === firstChild) continue;
    if (c.end <= firstChild.start && c.end > lb) lb = c.end;
  }
  return lb;
}

/**
 * Upper bound for scanning trailing comments after `lastChild`: the start of the
 * parent's close tag, tightened to the start of the nearest following sibling
 * if one exists. A trailing comment between `lastChild` and this bound moves
 * with the last reordered member.
 */
export function reorderUpperBound(
  source: string,
  parent: XmlElement,
  lastChild: XmlElement,
): number {
  // The parent's close tag is the last `</` at or before its end (comments use
  // `<!--`/`-->`, never `</`, so they don't interfere).
  const close = source.lastIndexOf("</", parent.end);
  let ub = close > lastChild.end ? close : parent.end;
  for (const c of parent.children) {
    if (c === lastChild) continue;
    if (c.start >= lastChild.end && c.start < ub) ub = c.start;
  }
  return ub;
}
