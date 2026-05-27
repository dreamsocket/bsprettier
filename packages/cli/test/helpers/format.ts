import { defaultConfig, type BsprettierConfig } from "../../src/config.js";
import { formatFile, type FormatFileResult } from "../../src/edit/runner.js";

export const config = defaultConfig();

interface FormatSourceOptions {
  filePath: string;
  source: string;
  config?: BsprettierConfig;
  onlyRules?: Set<string>;
  projectSources?: ReadonlyMap<string, string>;
}

export function formatSource(opts: FormatSourceOptions): FormatFileResult {
  return formatFile({
    config: opts.config ?? config,
    filePath: opts.filePath,
    source: opts.source,
    onlyRules: opts.onlyRules,
    projectSources: opts.projectSources,
  });
}

export function formatWithRule(
  ruleId: string,
  opts: Omit<FormatSourceOptions, "onlyRules">,
): FormatFileResult {
  return formatSource({
    ...opts,
    onlyRules: new Set([ruleId]),
  });
}
