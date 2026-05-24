import {
  classifyField,
  type FieldClass,
} from "../../classify/xml-interface-field.js";
import { walkElements, type XmlElement } from "../../parser/xml.js";
import {
  attrValue,
  computeReorderLayout,
  reorderLowerBound,
  reorderUpperBound,
  tagNameEquals,
} from "../../parser/xml-helpers.js";
import { asciiCompare } from "../../util/ascii-sort.js";
import { detectEol } from "../../util/eol.js";
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
          projectSources: ctx.projectSources,
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

    // Decide which comments travel with which member. Leading item comments
    // attach to the member below them; trailing comments to the member they
    // follow; section-header comments stay put as fixed run boundaries.
    const layout = computeReorderLayout(
      source,
      children,
      reorderLowerBound(source, iface, children[0]!),
      reorderUpperBound(source, iface, children[children.length - 1]!),
    );
    const refuse = (message: string): RuleResult => ({
      edits: [],
      diagnostics: [{ ruleId: RULE_ID, severity: ctx.severity, message, fixable: false }],
    });

    const hasHeaders = layout.members.some((m) => m.hasLeadingHeader);
    const isFn = (r: Row) => r.section === Section.Functions;
    let order: number[];
    if (!hasHeaders) {
      // No section comments: sort the whole interface into Events → Properties →
      // Functions, gathering each section together.
      order = rows.map((_, i) => i);
      order.sort((a, b) => {
        const ra = rows[a]!;
        const rb = rows[b]!;
        if (ra.section !== rb.section) return ra.section - rb.section;
        const cmp = asciiCompare(ra.sortKey, rb.sortKey);
        return cmp !== 0 ? cmp : a - b;
      });
    } else {
      // Section comments present: trust the author's grouping. Each header — and
      // each <field>↔<function> change — is a fixed run boundary; we never move
      // a run, only sort members alphabetically within it. This keeps section
      // labels anchored, preserves the author's Event/Property grouping even
      // when it disagrees with our classification, and never interleaves fields
      // with functions.
      const runs: number[][] = [];
      for (let i = 0; i < rows.length; i++) {
        const startsRun =
          i === 0 ||
          layout.members[i]!.hasLeadingHeader ||
          isFn(rows[i]!) !== isFn(rows[i - 1]!);
        if (startsRun) runs.push([i]);
        else runs[runs.length - 1]!.push(i);
      }
      order = [];
      for (const run of runs) {
        const sorted = [...run].sort((a, b) => {
          const cmp = asciiCompare(rows[a]!.sortKey, rows[b]!.sortKey);
          return cmp !== 0 ? cmp : a - b;
        });
        order.push(...sorted);
      }
    }

    const texts = layout.members.map((m) => source.slice(m.ownStart, m.end));

    // Build the reordered region. Separators between consecutive emitted members
    // differ by mode:
    // - No section headers: normalize blank lines. Members in the same section
    //   are packed tight (one line break); a section boundary (Events →
    //   Properties → Functions) gets exactly one blank line so the groups read
    //   as visibly separate.
    // - Section headers present: trust the author's layout and reuse the
    //   original separators positionally, so labelled groups and their spacing
    //   survive untouched.
    let replacement: string;
    if (!hasHeaders) {
      const eol = detectEol(source);
      replacement = texts[order[0]!]!;
      for (let i = 1; i < order.length; i++) {
        const sameSection =
          rows[order[i - 1]!]!.section === rows[order[i]!]!.section;
        replacement += (sameSection ? eol : eol + eol) + texts[order[i]!]!;
      }
    } else {
      const separators: string[] = [];
      for (let i = 1; i < layout.members.length; i++) {
        separators.push(
          source.slice(layout.members[i - 1]!.end, layout.members[i]!.ownStart),
        );
      }
      replacement = texts[order[0]!]!;
      for (let i = 1; i < order.length; i++) {
        replacement += separators[i - 1]! + texts[order[i]!]!;
      }
    }

    const regionStart = layout.members[0]!.ownStart;
    const regionEnd = layout.members[layout.members.length - 1]!.end;
    const original = source.slice(regionStart, regionEnd);

    // Already in canonical form (order and spacing): nothing to do. This is
    // checked against the rebuilt text, not just the order, so a needed
    // blank-line fix is not skipped when members are already sorted.
    if (replacement === original) {
      return { edits: [], diagnostics };
    }

    // A change is needed. Refuse only if a comment is stranded between members
    // and can't be carried with one of them.
    if (layout.unsafe) {
      return refuse(
        "A comment is stranded between <interface> members; section order " +
          "left unchanged to avoid misplacing it.",
      );
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
