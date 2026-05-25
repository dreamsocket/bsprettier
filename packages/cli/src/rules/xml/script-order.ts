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
import { detectEol } from "../../util/eol.js";
import type { XmlRule, XmlRuleContext } from "../rule.js";

const RULE_ID = "xml/script-order";

function basenameWithoutExtension(filePath: string): string {
  const name = filePath.replace(/^.*[\\/]/, "");
  return name.replace(/\.[^.\\/]+$/, "");
}

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

    // The component's direct script sits beside the XML and has the same
    // basename. It must load before sibling local helpers and shared pkg imports.
    const componentName = basenameWithoutExtension(ctx.filePath);
    const componentScriptPrefix = `${componentName}.`;
    const isCurrentDirectoryUri = (uri: string): boolean => {
      return !/^[a-z][a-z0-9+.-]*:/i.test(uri) && !/[\\/]/.test(uri);
    };
    const isDirectComponentScript = (s: XmlElement): boolean => {
      const uri = attrValue(s, "uri");
      return (
        uri !== undefined &&
        isCurrentDirectoryUri(uri) &&
        uri.startsWith(componentScriptPrefix) &&
        /^(brs|bs)$/i.test(uri.slice(componentScriptPrefix.length))
      );
    };
    const scriptRank = (s: XmlElement): number => {
      if (isDirectComponentScript(s)) return 0;
      const uri = attrValue(s, "uri") ?? "";
      if (isCurrentDirectoryUri(uri)) return 1;
      if (/^pkg:/i.test(uri)) return 2;
      return 3;
    };
    const spacingGroup = (s: XmlElement): number => {
      const uri = attrValue(s, "uri") ?? "";
      if (isCurrentDirectoryUri(uri)) return 0;
      if (/^pkg:\/source(?:\/|$)/i.test(uri)) return 2;
      if (/^pkg:/i.test(uri)) return 1;
      return 3;
    };

    const diagnostics: Diagnostic[] = [];

    const order = scripts.map((_, i) => i);
    order.sort((a, b) => {
      const sa = scripts[a]!;
      const sb = scripts[b]!;
      const rankDelta = scriptRank(sa) - scriptRank(sb);
      if (rankDelta !== 0) return rankDelta;
      const ua = attrValue(sa, "uri") ?? "";
      const ub = attrValue(sb, "uri") ?? "";
      const cmp = asciiCompare(ua, ub);
      return cmp !== 0 ? cmp : a - b;
    });

    // Attach each leading comment to the <script> below it so it moves with
    // that script. Refuse only when a comment can't be cleanly owned
    // (floating/trailing) or is a section header — deferred to later work.
    const layout = computeReorderLayout(
      source,
      scripts,
      reorderLowerBound(source, root, scripts[0]!),
      reorderUpperBound(source, root, scripts[scripts.length - 1]!),
    );
    const texts = layout.members.map((m) => source.slice(m.ownStart, m.end));
    const eol = detectEol(source);

    let replacement = texts[order[0]!]!;
    for (let i = 1; i < order.length; i++) {
      const previous = scripts[order[i - 1]!]!;
      const current = scripts[order[i]!]!;
      const separator =
        spacingGroup(previous) === spacingGroup(current) ? eol : eol + eol;
      replacement += separator + texts[order[i]!]!;
    }

    const regionStart = layout.members[0]!.ownStart;
    const regionEnd = layout.members[layout.members.length - 1]!.end;
    const original = source.slice(regionStart, regionEnd);
    if (replacement === original) {
      return { edits: [], diagnostics };
    }

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

    const edit: Edit = {
      ruleId: RULE_ID,
      offset: regionStart,
      length: regionEnd - regionStart,
      replacement,
    };
    return { edits: [edit], diagnostics };
  },
};
