import { Formatter } from "brighterscript-formatter";
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

/**
 * Run brighterscript-formatter (bsfmt) when configured. Used both as a
 * pre-processing pass (clean input for our AST rules) and as a final pass (fix
 * indentation drift introduced when our rules move whole declarations around).
 */
function runFormatter(
  text: string,
  config: BsprettierConfig,
  diagnostics: Diagnostic[],
): string {
  if (config.formatter === null || config.formatter === undefined) return text;
  try {
    return new Formatter().format(text, config.formatter);
  } catch (e: any) {
    diagnostics.push({
      ruleId: "brs/format-style",
      severity: "warn",
      message: `brighterscript-formatter error: ${e.message || String(e)}`,
      fixable: false,
    });
    return text;
  }
}

/**
 * Drop fixable diagnostics whose fix is actually applied this phase. A fixable
 * diagnostic is redundant once its edit lands in the output — the change itself
 * is the report. We keep it only when the fix is NOT applied: a collision left
 * it edit-less, or a conflict dropped the whole phase. Matched to its edit by
 * rule id and span offset (both still in the phase's pre-apply coordinates).
 */
function reportableDiagnostics(
  phaseDiags: Diagnostic[],
  appliedEdits: Edit[],
): Diagnostic[] {
  if (appliedEdits.length === 0) return phaseDiags;
  const applied = new Set(appliedEdits.map((e) => `${e.ruleId}@${e.offset}`));
  return phaseDiags.filter(
    (d) =>
      !(d.fixable && d.span && applied.has(`${d.ruleId}@${d.span.offset}`)),
  );
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
  const diagnostics: Diagnostic[] = [];
  const appliedRuleIds = new Set<string>();

  // Whole-file suppression check first
  const suppressionCheck = buildSuppressionMap(source, "brs");
  if (suppressionCheck.fileDisabled) {
    return unchanged(filePath, source, diagnostics);
  }

  const originalParse = parseBrs(source, filePath);
  if (originalParse.fatal) {
    return {
      filePath,
      status: "parse-error",
      output: source,
      changed: false,
      diagnostics,
      ruleIds: [],
      errorMessage: originalParse.diagnostics
        .filter((d) => d.severity === 1)
        .map((d) => d.message)
        .join("; "),
    };
  }

  let current = source;

  // Pre-processing pass: clean input so our AST rules see well-formed source.
  const preFormatted = runFormatter(current, config, diagnostics);
  if (preFormatted !== current) {
    current = preFormatted;
    appliedRuleIds.add("brs/format-style");
  }

  const initial =
    current === source ? originalParse : parseBrs(current, filePath);
  if (initial.fatal) {
    return {
      filePath,
      status: "parse-error",
      output: source,
      changed: false,
      diagnostics,
      ruleIds: [],
      errorMessage: initial.diagnostics
        .filter((d) => d.severity === 1)
        .map((d) => d.message)
        .join("; "),
    };
  }

  if (active.length === 0) {
    const changed = current !== source;
    return {
      filePath,
      status: changed ? "changed" : "unchanged",
      output: current,
      changed,
      diagnostics,
      ruleIds: [...appliedRuleIds],
    };
  }

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
    const phaseDiags: Diagnostic[] = [];
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
        phaseDiags.push(d);
      }
    }
    const conflict = findConflict(phaseEdits);
    if (conflict) {
      // The fix did not land, so the fixable diagnostics stay visible.
      diagnostics.push(...phaseDiags);
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
    diagnostics.push(...reportableDiagnostics(phaseDiags, phaseEdits));
  }

  // Final pass: re-run bsfmt to repair indentation/spacing drift left behind
  // when our rules relocated whole declarations (e.g. a routine moved together
  // with its leading comment). bsfmt is idempotent and preserves our `if(`
  // spelling, so it only cleans up the layout.
  const postFormatted = runFormatter(current, config, diagnostics);
  if (postFormatted !== current) {
    current = postFormatted;
    appliedRuleIds.add("brs/format-style");
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
    const phaseDiags: Diagnostic[] = [];
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
        phaseDiags.push(d);
      }
    }
    const conflict = findConflict(phaseEdits);
    if (conflict) {
      // The fix did not land, so the fixable diagnostics stay visible.
      diagnostics.push(...phaseDiags);
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
    diagnostics.push(...reportableDiagnostics(phaseDiags, phaseEdits));
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
