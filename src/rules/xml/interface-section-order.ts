import {
  classifyField,
  type FieldClass,
} from "../../classify/xml-interface-field.js";
import { walkElements, type XmlElement } from "../../parser/xml.js";
import {
  attrValue,
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

const RULE_ID = "xml/interface-section-order";

enum Section {
  Events = 0,
  Properties = 1,
  Functions = 2,
}

interface Row {
  el: XmlElement;
  section: Section;
  sortKey: string;
}

export const interfaceSectionOrder: XmlRule = {
  id: RULE_ID,
  lang: "xml",
  phase: 2,
  run(ctx: XmlRuleContext): RuleResult {
    const { parse, source, filePath, config } = ctx;
    if (!parse.root) return emptyResult();

    let iface: XmlElement | null = null;
    for (const el of walkElements(parse.root)) {
      if (tagNameEquals(el, "interface")) {
        iface = el;
        break;
      }
    }
    if (!iface) return emptyResult();

    const children = iface.children;
    if (children.length < 2) return emptyResult();

    // Refuse if comments sit between interface members, or immediately before
    // the first member — the slot-separator splice would re-attach such a
    // comment to the wrong member.
    if (
      separatorsHaveComments(source, children) ||
      commentBeforeElement(source, iface, children[0]!)
    ) {
      return {
        edits: [],
        diagnostics: [
          {
            ruleId: RULE_ID,
            severity: ctx.severity,
            message:
              "Comments sit between <interface> members; section order left " +
              "unchanged to avoid misplacing them.",
            fixable: false,
          },
        ],
      };
    }

    const componentName = attrValue(parse.root, "name") ?? "";
    const diagnostics: Diagnostic[] = [];
    const rows: Row[] = [];
    const ambiguous: string[] = [];

    for (const child of children) {
      if (tagNameEquals(child, "function")) {
        rows.push({
          el: child,
          section: Section.Functions,
          sortKey: attrValue(child, "name") ?? "",
        });
      } else if (tagNameEquals(child, "field")) {
        const fieldId = attrValue(child, "id") ?? "";
        const klass: FieldClass = classifyField({
          filePath,
          componentName,
          fieldId,
          fieldElement: child,
          config,
        });
        if (klass === "ambiguous") {
          ambiguous.push(fieldId);
        }
        rows.push({
          el: child,
          section:
            klass === "event" ? Section.Events : Section.Properties,
          sortKey: fieldId,
        });
      } else {
        // Unknown element inside <interface> — refuse to reorder.
        return {
          edits: [],
          diagnostics: [
            {
              ruleId: RULE_ID,
              severity: ctx.severity,
              message:
                `Unexpected <${child.name}> inside <interface>; section ` +
                "order left unchanged.",
              fixable: false,
            },
          ],
        };
      }
    }

    if (ambiguous.length > 0) {
      return {
        edits: [],
        diagnostics: [
          {
            ruleId: RULE_ID,
            severity: ctx.severity,
            message:
              "Ambiguous Event/Property classification for field(s): " +
              `${ambiguous.join(", ")}. Interface not reordered. Add a ` +
              "fieldClassificationOverrides entry to resolve.",
            fixable: false,
          },
        ],
      };
    }

    const order = rows.map((_, i) => i);
    order.sort((a, b) => {
      const ra = rows[a]!;
      const rb = rows[b]!;
      if (ra.section !== rb.section) return ra.section - rb.section;
      const cmp = asciiCompare(ra.sortKey, rb.sortKey);
      return cmp !== 0 ? cmp : a - b;
    });

    if (order.every((v, i) => v === i)) {
      return { edits: [], diagnostics };
    }

    const texts = children.map((c) => source.slice(c.start, c.end));
    const separators: string[] = [];
    for (let i = 1; i < children.length; i++) {
      separators.push(source.slice(children[i - 1]!.end, children[i]!.start));
    }

    let replacement = texts[order[0]!]!;
    for (let i = 1; i < order.length; i++) {
      replacement += separators[i - 1]! + texts[order[i]!]!;
    }

    const regionStart = children[0]!.start;
    const regionEnd = children[children.length - 1]!.end;
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
