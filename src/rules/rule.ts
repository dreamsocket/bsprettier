import type { BsprettierConfig } from "../config.js";
import type { RuleResult, Severity } from "../edit/types.js";
import type { BrsParseResult } from "../parser/brighterscript-adapter.js";
import type { XmlParseResult } from "../parser/xml.js";

export interface BaseRuleContext {
  filePath: string;
  source: string;
  config: BsprettierConfig;
  /** All files currently being formatted, when running in project/CLI mode. */
  projectSources?: ReadonlyMap<string, string>;
  /** Effective severity for this rule (never "off" — off rules don't run). */
  severity: Severity;
}

export interface BrsRuleContext extends BaseRuleContext {
  parse: BrsParseResult;
}

export interface XmlRuleContext extends BaseRuleContext {
  parse: XmlParseResult;
}

export interface BrsRule {
  id: string;
  lang: "brs";
  /** Pipeline phase index — lower runs first; rules in the same phase compose. */
  phase: number;
  run(ctx: BrsRuleContext): RuleResult;
}

export interface XmlRule {
  id: string;
  lang: "xml";
  phase: number;
  run(ctx: XmlRuleContext): RuleResult;
}

export type Rule = BrsRule | XmlRule;
