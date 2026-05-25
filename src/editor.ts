import { dirname, resolve } from "node:path";
import {
  loadConfig,
  type BsprettierConfig,
} from "./config.js";
import {
  formatFile,
  type FormatFileResult,
} from "./edit/runner.js";
import type { ProjectContext } from "./project/context.js";

export interface SingleFileEditorFormatOptions {
  filePath: string;
  source: string;
  configPath?: string;
  onlyRules?: Set<string>;
  cwd?: string;
}

export interface ProjectEditorFormatOptions extends SingleFileEditorFormatOptions {
  projectSources: ReadonlyMap<string, string>;
  projectContext: ProjectContext;
}

export function loadEditorConfig(
  opts: Pick<SingleFileEditorFormatOptions, "configPath" | "cwd" | "filePath">,
): BsprettierConfig {
  const cwd = opts.cwd ?? process.cwd();
  return loadConfig({
    configPath: opts.configPath
      ? resolve(cwd, opts.configPath)
      : undefined,
    searchFrom: dirname(resolve(cwd, opts.filePath)),
  });
}

export function formatSingleFileForEditor(
  opts: SingleFileEditorFormatOptions,
): FormatFileResult {
  const config = loadEditorConfig(opts);
  return formatFile({
    filePath: opts.filePath,
    source: opts.source,
    config,
    onlyRules: opts.onlyRules,
  });
}

export function formatProjectFileForEditor(
  opts: ProjectEditorFormatOptions,
): FormatFileResult {
  const config = loadEditorConfig(opts);
  return formatFile({
    filePath: opts.filePath,
    source: opts.source,
    config,
    onlyRules: opts.onlyRules,
    projectSources: opts.projectSources,
    projectContext: opts.projectContext,
  });
}
