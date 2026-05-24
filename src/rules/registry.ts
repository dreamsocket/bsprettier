import { declarationOrder } from "./brs/declaration-order.js";
import { declarationSpacing } from "./brs/declaration-spacing.js";
import { blockIfForm } from "./brs/block-if-form.js";
import { ifConditionParens } from "./brs/if-condition-parens.js";
import { attributeOrder } from "./xml/attribute-order.js";
import { scriptOrder } from "./xml/script-order.js";
import { interfaceSectionOrder } from "./xml/interface-section-order.js";
import { noOnchangeField } from "./xml/no-onchange-field.js";
import { handlerIntent } from "./audit/handler-intent.js";
import { uiNodePrefix } from "./audit/ui-node-prefix.js";
import {
  privateInterfaceFunctionNaming,
  privateMemberNaming,
} from "./audit/private-member-naming.js";
import { hardcodedString } from "./audit/hardcoded-string.js";
import { preferDreamsocketUtils } from "./audit/prefer-dreamsocket-utils.js";
import type { BrsRule, XmlRule } from "./rule.js";

export const BRS_RULES: BrsRule[] = [
  declarationOrder,
  declarationSpacing,
  blockIfForm,
  ifConditionParens,
  handlerIntent,
  uiNodePrefix,
  privateMemberNaming,
  hardcodedString,
  preferDreamsocketUtils,
];

export const XML_RULES: XmlRule[] = [
  attributeOrder,
  scriptOrder,
  interfaceSectionOrder,
  noOnchangeField,
  privateInterfaceFunctionNaming,
];

export const ALL_RULE_IDS: string[] = [
  "brs/format-style",
  ...BRS_RULES.map((r) => r.id),
  ...XML_RULES.map((r) => r.id),
];

export function maxPhase(rules: { phase: number }[]): number {
  return rules.reduce((max, r) => Math.max(max, r.phase), 0);
}
