import { walkElements, type XmlElement } from "../../parser/xml.js";
import { asciiCompare } from "../../util/ascii-sort.js";
import { emptyResult, type Edit, type RuleResult } from "../../edit/types.js";
import type { XmlRule, XmlRuleContext } from "../rule.js";

const RULE_ID = "xml/attribute-order";

/** The attribute name that must sort first for a given element, if any. */
function pinnedAttr(elementName: string): string {
  const lower = elementName.toLowerCase();
  // <component> pins `name`; <function> pins `name`.
  if (lower === "component" || lower === "function") return "name";
  // <field> and SceneGraph nodes pin `id`; for everything else `id` still
  // sorts first when present, which this covers too.
  return "id";
}

function orderAttributes(el: XmlElement): number[] {
  const pinned = pinnedAttr(el.name);
  const indices = el.attributes.map((_, i) => i);
  return indices.sort((a, b) => {
    const na = el.attributes[a]!.name;
    const nb = el.attributes[b]!.name;
    const aPinned = na === pinned;
    const bPinned = nb === pinned;
    if (aPinned && !bPinned) return -1;
    if (bPinned && !aPinned) return 1;
    return asciiCompare(na, nb);
  });
}

export const attributeOrder: XmlRule = {
  id: RULE_ID,
  lang: "xml",
  phase: 0,
  run(ctx: XmlRuleContext): RuleResult {
    const { parse, source } = ctx;
    if (!parse.root) return emptyResult();

    const edits: Edit[] = [];
    for (const el of walkElements(parse.root)) {
      if (el.attributes.length < 2) continue;
      if (el.attributesStart == null || el.attributesEnd == null) continue;

      const order = orderAttributes(el);
      const isIdentity = order.every((v, i) => v === i);
      if (isIdentity) continue;

      const texts = el.attributes.map((a) => source.slice(a.start, a.end));
      const separators: string[] = [];
      for (let i = 1; i < el.attributes.length; i++) {
        separators.push(
          source.slice(el.attributes[i - 1]!.end, el.attributes[i]!.start),
        );
      }

      let replacement = texts[order[0]!]!;
      for (let i = 1; i < order.length; i++) {
        replacement += separators[i - 1]! + texts[order[i]!]!;
      }

      const original = source.slice(el.attributesStart, el.attributesEnd);
      if (replacement === original) continue;

      edits.push({
        ruleId: RULE_ID,
        offset: el.attributesStart,
        length: el.attributesEnd - el.attributesStart,
        replacement,
      });
    }

    if (edits.length === 0) return emptyResult();
    return { edits, diagnostics: [] };
  },
};
