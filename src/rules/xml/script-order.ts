import { type XmlElement } from "../../parser/xml.js";
import {
  attrValue,
  baseNameNoExt,
  commentBeforeElement,
  separatorsHaveComments,
  tagNameEquals,
} from "../../parser/xml-helpers.js";
import { asciiCompare } from "../../util/ascii-sort.js";
import {
  emptyResult,
  type Diagnostic,
  type Edit,
  type RuleResult,
} from "../../edit/types.js";
import type { XmlRule, XmlRuleContext } from "../rule.js";

const RULE_ID = "xml/script-order";

export const scriptOrder: XmlRule = {
  id: RULE_ID,
  lang: "xml",
  phase: 1,
  run(ctx: XmlRuleContext): RuleResult {
    const { parse, source, filePath } = ctx;
    const root = parse.root;
    if (!root || !tagNameEquals(root, "component")) return emptyResult();

    const scripts = root.children.filter((c) => tagNameEquals(c, "script"));
    if (scripts.length < 2) return emptyResult();

    // Only reorder if the scripts form a contiguous run of siblings — moving a
    // script past an <interface> or <children> block would be unsafe.
    const firstStart = scripts[0]!.start;
    const lastEnd = scripts[scripts.length - 1]!.end;
    const interloper = root.children.find(
      (c) =>
        !tagNameEquals(c, "script") &&
        c.start >= firstStart &&
        c.end <= lastEnd,
    );
    if (interloper) {
      return {
        edits: [],
        diagnostics: [
          {
            ruleId: RULE_ID,
            severity: ctx.severity,
            message:
              "<script> elements are not contiguous siblings; script order " +
              "left unchanged.",
            fixable: false,
          },
        ],
      };
    }

    // Refuse if comments sit between scripts, or immediately before the first
    // script — reordering would re-attach such a comment to the wrong <script>.
    if (
      separatorsHaveComments(source, scripts) ||
      commentBeforeElement(source, root, scripts[0]!)
    ) {
      return {
        edits: [],
        diagnostics: [
          {
            ruleId: RULE_ID,
            severity: ctx.severity,
            message:
              "Comments sit between <script> elements; script order left " +
              "unchanged to avoid misplacing them.",
            fixable: false,
          },
        ],
      };
    }

    const componentName = attrValue(root, "name") ?? "";
    const fileBase = baseNameNoExt(filePath);

    const isLocal = (s: XmlElement): boolean => {
      const uri = attrValue(s, "uri");
      if (!uri) return false;
      const base = baseNameNoExt(uri);
      return base === componentName || base === fileBase;
    };

    const diagnostics: Diagnostic[] = [];
    const localIndices = scripts
      .map((s, i) => (isLocal(s) ? i : -1))
      .filter((i) => i >= 0);
    if (localIndices.length > 1) {
      diagnostics.push({
        ruleId: RULE_ID,
        severity: ctx.severity,
        message:
          "Multiple <script> elements look local to this component; their " +
          "relative order is preserved.",
        fixable: false,
      });
    }

    const order = scripts.map((_, i) => i);
    order.sort((a, b) => {
      const sa = scripts[a]!;
      const sb = scripts[b]!;
      const aLocal = localIndices.includes(a);
      const bLocal = localIndices.includes(b);
      if (aLocal && !bLocal) return -1;
      if (bLocal && !aLocal) return 1;
      if (aLocal && bLocal) return a - b; // preserve relative order
      const ua = attrValue(sa, "uri") ?? "";
      const ub = attrValue(sb, "uri") ?? "";
      const cmp = asciiCompare(ua, ub);
      return cmp !== 0 ? cmp : a - b;
    });

    if (order.every((v, i) => v === i)) {
      return { edits: [], diagnostics };
    }

    const texts = scripts.map((s) => source.slice(s.start, s.end));
    const separators: string[] = [];
    for (let i = 1; i < scripts.length; i++) {
      separators.push(source.slice(scripts[i - 1]!.end, scripts[i]!.start));
    }

    let replacement = texts[order[0]!]!;
    for (let i = 1; i < order.length; i++) {
      replacement += separators[i - 1]! + texts[order[i]!]!;
    }

    const original = source.slice(firstStart, lastEnd);
    if (replacement === original) {
      return { edits: [], diagnostics };
    }

    const edit: Edit = {
      ruleId: RULE_ID,
      offset: firstStart,
      length: lastEnd - firstStart,
      replacement,
    };
    return { edits: [edit], diagnostics };
  },
};
