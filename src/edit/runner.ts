import { ruleSetting, type BsprettierConfig } from "../config.js";
import { parseBrs } from "../parser/brighterscript-adapter.js";
import { parseXml } from "../parser/xml.js";
import { BRS_RULES, XML_RULES } from "../rules/registry.js";
import type { BrsRule, XmlRule } from "../rules/rule.js";
import { applyEdits, findConflict, isNoOpEdit } from "./apply.js";
import { buildSuppressionMap, isSuppressed } from "./suppression.js";
import type { Diagnostic, Edit, Severity } from "./types.js";

export type FileStatus = "unchanged" | "changed" | "parse-error" | "conflict";

export interface FormatFileResult {
  filePath: string;
  status: FileStatus;
  output: string;
  changed: boolean;
  diagnostics: Diagnostic[];
  /** Rule ids that produced applied edits. */
  ruleIds: string[];
  errorMessage?: string;
}

export interface FormatOptions {
  filePath: string;
  source: string;
  config: BsprettierConfig;
  /** All files in the current formatting pass, for cross-file audit rules. */
  projectSources?: ReadonlyMap<string, string>;
  /** Restrict to these rule ids (still phase-ordered). */
  onlyRules?: Set<string>;
}

export type Lang = "brs" | "xml";

export function detectLang(filePath: string): Lang | null {
  if (/\.(brs|bs)$/i.test(filePath)) return "brs";
  if (/\.xml$/i.test(filePath)) return "xml";
  return null;
}

interface ActiveRule<R> {
  rule: R;
  severity: Severity;
}

function selectRules<R extends BrsRule | XmlRule>(
  rules: R[],
  config: BsprettierConfig,
  onlyRules: Set<string> | undefined,
): ActiveRule<R>[] {
  const active: ActiveRule<R>[] = [];
  for (const rule of rules) {
    if (onlyRules && !onlyRules.has(rule.id)) continue;
    const setting = ruleSetting(config, rule.id);
    if (setting === "off") continue;
    active.push({ rule, severity: setting });
  }
  return active;
}

function phasesOf<R extends { phase: number }>(rules: ActiveRule<R>[]): number[] {
  return [...new Set(rules.map((r) => r.rule.phase))].sort((a, b) => a - b);
}

function unchanged(
  filePath: string,
  source: string,
  diagnostics: Diagnostic[],
): FormatFileResult {
  return {
    filePath,
    status: "unchanged",
    output: source,
    changed: false,
    diagnostics,
    ruleIds: [],
  };
}

export function formatFile(opts: FormatOptions): FormatFileResult {
  const { filePath, source, config, onlyRules, projectSources } = opts;
  const lang = detectLang(filePath);
  if (!lang) {
    return unchanged(filePath, source, []);
  }
  return lang === "brs"
    ? formatBrs(filePath, source, config, onlyRules, projectSources)
    : formatXml(filePath, source, config, onlyRules, projectSources);
}

function formatBrs(
  filePath: string,
  source: string,
  config: BsprettierConfig,
  onlyRules: Set<string> | undefined,
  projectSources: ReadonlyMap<string, string> | undefined,
): FormatFileResult {
  const active = selectRules<BrsRule>(BRS_RULES, config, onlyRules);
  const initial = parseBrs(source, filePath);
  if (initial.fatal) {
    return {
      filePath,
      status: "parse-error",
      output: source,
      changed: false,
      diagnostics: [],
      ruleIds: [],
      errorMessage: initial.diagnostics
        .filter((d) => d.severity === 1)
        .map((d) => d.message)
        .join("; "),
    };
  }
  if (active.length === 0) return unchanged(filePath, source, []);

  let current = source;
  const diagnostics: Diagnostic[] = [];
  const appliedRuleIds = new Set<string>();

  for (const phase of phasesOf(active)) {
    const suppression = buildSuppressionMap(current, "brs");
    if (suppression.fileDisabled) {
      return unchanged(filePath, source, diagnostics);
    }
    const parse = parseBrs(current, filePath);
    if (parse.fatal) {
      return {
        filePath,
        status: "parse-error",
        output: source,
        changed: false,
        diagnostics,
        ruleIds: [],
        errorMessage: "file no longer parses after an intermediate phase",
      };
    }
    const phaseEdits: Edit[] = [];
    for (const { rule, severity } of active) {
      if (rule.phase !== phase) continue;
      const result = rule.run({
        filePath,
        source: current,
        config,
        projectSources,
        severity,
        parse,
      });
      for (const e of result.edits) {
        if (isSuppressed(suppression, e.offset, e.ruleId)) continue;
        if (severity === "info") continue;
        if (isNoOpEdit(current, e)) continue;
        phaseEdits.push(e);
      }
      for (const d of result.diagnostics) {
        if (d.span && isSuppressed(suppression, d.span.offset, d.ruleId)) {
          continue;
        }
        diagnostics.push(d);
      }
    }
    const conflict = findConflict(phaseEdits);
    if (conflict) {
      return {
        filePath,
        status: "conflict",
        output: source,
        changed: false,
        diagnostics,
        ruleIds: [],
        errorMessage: `edit conflict between ${conflict.ruleA} and ${conflict.ruleB} at offset ${conflict.offset}`,
      };
    }
    if (phaseEdits.length > 0) {
      for (const e of phaseEdits) appliedRuleIds.add(e.ruleId);
      current = applyEdits(current, phaseEdits);
    }
  }

  const finalParse = parseBrs(current, filePath);
  if (finalParse.fatal) {
    return {
      filePath,
      status: "parse-error",
      output: source,
      changed: false,
      diagnostics,
      ruleIds: [],
      errorMessage: "formatted output no longer parses; file left untouched",
    };
  }

  const changed = current !== source;
  return {
    filePath,
    status: changed ? "changed" : "unchanged",
    output: current,
    changed,
    diagnostics,
    ruleIds: [...appliedRuleIds].sort(),
  };
}

function formatXml(
  filePath: string,
  source: string,
  config: BsprettierConfig,
  onlyRules: Set<string> | undefined,
  projectSources: ReadonlyMap<string, string> | undefined,
): FormatFileResult {
  const active = selectRules<XmlRule>(XML_RULES, config, onlyRules);
  const initial = parseXml(source);
  if (initial.fatal) {
    return {
      filePath,
      status: "parse-error",
      output: source,
      changed: false,
      diagnostics: [],
      ruleIds: [],
      errorMessage: initial.errors.join("; "),
    };
  }
  if (active.length === 0) return unchanged(filePath, source, []);

  let current = source;
  const diagnostics: Diagnostic[] = [];
  const appliedRuleIds = new Set<string>();

  for (const phase of phasesOf(active)) {
    const suppression = buildSuppressionMap(current, "xml");
    if (suppression.fileDisabled) {
      return unchanged(filePath, source, diagnostics);
    }
    const parse = parseXml(current);
    if (parse.fatal) {
      return {
        filePath,
        status: "parse-error",
        output: source,
        changed: false,
        diagnostics,
        ruleIds: [],
        errorMessage: "file no longer parses after an intermediate phase",
      };
    }
    const phaseEdits: Edit[] = [];
    for (const { rule, severity } of active) {
      if (rule.phase !== phase) continue;
      const result = rule.run({
        filePath,
        source: current,
        config,
        projectSources,
        severity,
        parse,
      });
      for (const e of result.edits) {
        if (isSuppressed(suppression, e.offset, e.ruleId)) continue;
        if (severity === "info") continue;
        if (isNoOpEdit(current, e)) continue;
        phaseEdits.push(e);
      }
      for (const d of result.diagnostics) {
        if (d.span && isSuppressed(suppression, d.span.offset, d.ruleId)) {
          continue;
        }
        diagnostics.push(d);
      }
    }
    const conflict = findConflict(phaseEdits);
    if (conflict) {
      return {
        filePath,
        status: "conflict",
        output: source,
        changed: false,
        diagnostics,
        ruleIds: [],
        errorMessage: `edit conflict between ${conflict.ruleA} and ${conflict.ruleB} at offset ${conflict.offset}`,
      };
    }
    if (phaseEdits.length > 0) {
      for (const e of phaseEdits) appliedRuleIds.add(e.ruleId);
      current = applyEdits(current, phaseEdits);
    }
  }

  const finalParse = parseXml(current);
  if (finalParse.fatal) {
    return {
      filePath,
      status: "parse-error",
      output: source,
      changed: false,
      diagnostics,
      ruleIds: [],
      errorMessage: "formatted output no longer parses; file left untouched",
    };
  }

  const changed = current !== source;
  return {
    filePath,
    status: changed ? "changed" : "unchanged",
    output: current,
    changed,
    diagnostics,
    ruleIds: [...appliedRuleIds].sort(),
  };
}
