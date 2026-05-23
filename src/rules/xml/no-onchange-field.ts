import { walkElements } from "../../parser/xml.js";
import { attrValue, tagNameEquals } from "../../parser/xml-helpers.js";
import {
  emptyResult,
  type Diagnostic,
  type RuleResult,
} from "../../edit/types.js";
import { setterHandlerName } from "../../util/observer-handler.js";
import type { XmlRule, XmlRuleContext } from "../rule.js";

const RULE_ID = "xml/no-onchange-field";

export const noOnchangeField: XmlRule = {
  id: RULE_ID,
  lang: "xml",
  phase: 3,
  run(ctx: XmlRuleContext): RuleResult {
    const { parse } = ctx;
    if (!parse.root) return emptyResult();

    const diagnostics: Diagnostic[] = [];
    for (const el of walkElements(parse.root)) {
      if (!tagNameEquals(el, "field")) continue;
      const onChange = el.attributes.find(
        (a) => a.name.toLowerCase() === "onchange",
      );
      if (!onChange) continue;
      const fieldId = attrValue(el, "id") ?? "(unknown)";
      const handler = setterHandlerName(fieldId);
      diagnostics.push({
        ruleId: RULE_ID,
        severity: ctx.severity,
        message:
          `<field id="${fieldId}"> uses onChange; remove the attribute and ` +
          `add m.top.observeFieldScoped("${fieldId}", "${handler}") in init().`,
        span: { offset: onChange.start, length: onChange.end - onChange.start },
        fixable: false,
      });
    }

    if (diagnostics.length === 0) return emptyResult();
    return { edits: [], diagnostics };
  },
};
