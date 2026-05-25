import { readFileSync } from "node:fs";
import { loadConfig, type BsprettierConfig } from "./config.js";
import {
  formatFile,
  type FormatFileResult,
  type FormatOptions,
} from "./edit/runner.js";

export { formatFile } from "./edit/runner.js";
export {
  formatProjectFileForEditor,
  formatSingleFileForEditor,
  loadEditorConfig,
} from "./editor.js";
export type {
  ProjectEditorFormatOptions,
  SingleFileEditorFormatOptions,
} from "./editor.js";
export {
  WorkspaceFormatService,
} from "./editor/workspace-service.js";
export type {
  EditorFormatMode,
  WorkspaceDocument,
  WorkspaceFormatRequest,
  WorkspaceFormatResponse,
  WorkspaceFormatServiceOptions,
} from "./editor/workspace-service.js";
export type {
  FormatFileResult,
  FormatOptions,
  FileStatus,
  Lang,
} from "./edit/runner.js";
export { loadConfig, defaultConfig } from "./config.js";
export type { BsprettierConfig, RuleSetting } from "./config.js";
export { ALL_RULE_IDS } from "./rules/registry.js";
export type { Diagnostic, Edit, Severity } from "./edit/types.js";

/** Format a source string. `filePath` supplies the file type and config cwd. */
export function formatText(
  filePath: string,
  source: string,
  config?: BsprettierConfig,
): FormatFileResult {
  const opts: FormatOptions = {
    filePath,
    source,
    config: config ?? loadConfig(),
  };
  return formatFile(opts);
}

/** Read a file from disk and format it. */
export function formatFileFromDisk(
  filePath: string,
  config?: BsprettierConfig,
): FormatFileResult {
  const source = readFileSync(filePath, "utf8");
  return formatText(filePath, source, config);
}
