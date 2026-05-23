import { type XmlElement } from "../../parser/xml.js";
import {
  attrValue,
  computeReorderLayout,
  reorderLowerBound,
  reorderUpperBound,
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
    const { parse, source } = ctx;
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

    // Scripts referenced by a bare filename live beside the component XML.
    // Keep those local includes above path/protocol imports, even when a
    // library import has the same basename.
    const isCurrentDirectoryUri = (uri: string): boolean => {
      return !/^[a-z][a-z0-9+.-]*:/i.test(uri) && !/[\\/]/.test(uri);
    };
    const isLocal = (s: XmlElement): boolean => {
      const uri = attrValue(s, "uri");
      return uri ? isCurrentDirectoryUri(uri) : false;
    };

    const diagnostics: Diagnostic[] = [];

    const order = scripts.map((_, i) => i);
    order.sort((a, b) => {
      const sa = scripts[a]!;
      const sb = scripts[b]!;
      const aLocal = isLocal(sa);
      const bLocal = isLocal(sb);
      if (aLocal && !bLocal) return -1;
      if (bLocal && !aLocal) return 1;
      const ua = attrValue(sa, "uri") ?? "";
      const ub = attrValue(sb, "uri") ?? "";
      const cmp = asciiCompare(ua, ub);
      return cmp !== 0 ? cmp : a - b;
    });

    if (order.every((v, i) => v === i)) {
      return { edits: [], diagnostics };
    }

    // A reorder is needed. Attach each leading comment to the <script> below it
    // so it moves with that script. Refuse only when a comment can't be cleanly
    // owned (floating/trailing) or is a section header — deferred to later work.
    const layout = computeReorderLayout(
      source,
      scripts,
      reorderLowerBound(source, root, scripts[0]!),
      reorderUpperBound(source, root, scripts[scripts.length - 1]!),
    );
    if (layout.unsafe || layout.members.some((m) => m.hasLeadingHeader)) {
      diagnostics.push({
        ruleId: RULE_ID,
        severity: ctx.severity,
        message:
          "Comments sit between <script> elements; script order left " +
          "unchanged to avoid misplacing them.",
        fixable: false,
      });
      return { edits: [], diagnostics };
    }

    const texts = layout.members.map((m) => source.slice(m.ownStart, m.end));
    const separators: string[] = [];
    for (let i = 1; i < layout.members.length; i++) {
      separators.push(
        source.slice(layout.members[i - 1]!.end, layout.members[i]!.ownStart),
      );
    }

    let replacement = texts[order[0]!]!;
    for (let i = 1; i < order.length; i++) {
      replacement += separators[i - 1]! + texts[order[i]!]!;
    }

    const regionStart = layout.members[0]!.ownStart;
    const regionEnd = layout.members[layout.members.length - 1]!.end;
    const original = source.slice(regionStart, regionEnd);
    if (replacement === original) {
      return { edits: [], diagnostics };
    }

    const edit: Edit = {
      ruleId: RULE_ID,
      offset: regionStart,
      length: regionEnd - regionStart,
      replacement,
    };
    return { edits: [edit], diagnostics };
  },
};
