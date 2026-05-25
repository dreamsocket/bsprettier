import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
  type BsprettierConfig,
} from "../config.js";
import {
  formatFile,
  type FormatFileResult,
} from "../edit/runner.js";
import {
  getProjectContext,
  type ProjectContext,
} from "../project/context.js";
import { discoverFiles } from "../project/discovery.js";
import { formatSingleFileForEditor, loadEditorConfig } from "../editor.js";

export type EditorFormatMode = "project" | "singleFile";

export interface WorkspaceFormatServiceOptions {
  cwd?: string;
  configPath?: string;
  onlyRules?: Set<string>;
}

export interface WorkspaceDocument {
  filePath: string;
  source: string;
}

export interface WorkspaceFormatRequest extends WorkspaceDocument {
  mode?: EditorFormatMode;
}

export interface WorkspaceFormatResponse {
  mode: EditorFormatMode;
  result: FormatFileResult;
  degradedReason?: string;
}

function absoluteFrom(cwd: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

function sourceSetSignature(config: BsprettierConfig): string {
  return JSON.stringify({
    include: config.include,
    ignore: config.ignore,
  });
}

export class WorkspaceFormatService {
  private projectSources = new Map<string, string>();
  private projectContext: ProjectContext | undefined;
  private signature: string | undefined;

  readonly cwd: string;
  readonly configPath: string | undefined;
  readonly onlyRules: Set<string> | undefined;

  constructor(opts: WorkspaceFormatServiceOptions = {}) {
    this.cwd = opts.cwd ?? process.cwd();
    this.configPath = opts.configPath;
    this.onlyRules = opts.onlyRules;
  }

  updateDocument(document: WorkspaceDocument): void {
    const absPath = absoluteFrom(this.cwd, document.filePath);
    if (this.projectSources.get(absPath) === document.source) return;

    const next = new Map(this.projectSources);
    next.set(absPath, document.source);
    this.replaceSources(next);
  }

  removeDocument(filePath: string): void {
    const next = new Map(this.projectSources);
    next.delete(absoluteFrom(this.cwd, filePath));
    this.replaceSources(next);
  }

  refresh(config = this.loadConfigFor(this.cwd)): void {
    const files = discoverFiles([], config, this.cwd);
    const next = new Map<string, string>();
    for (const filePath of files) {
      try {
        next.set(filePath, readFileSync(filePath, "utf8"));
      } catch {
        // Ignore files that disappear or become unreadable during discovery.
      }
    }
    this.signature = sourceSetSignature(config);
    this.replaceSources(next);
  }

  format(request: WorkspaceFormatRequest): WorkspaceFormatResponse {
    if (request.mode === "singleFile") {
      return {
        mode: "singleFile",
        result: this.formatSingleFile(request),
      };
    }

    const config = this.loadConfigFor(request.filePath);
    this.refreshIfNeeded(config);
    this.updateDocument(request);

    const context = this.projectContext;
    if (!context) {
      return {
        mode: "singleFile",
        degradedReason: "project context is unavailable",
        result: this.formatSingleFile(request),
      };
    }

    const absPath = absoluteFrom(this.cwd, request.filePath);
    return {
      mode: "project",
      result: formatFile({
        filePath: absPath,
        source: request.source,
        config,
        onlyRules: this.onlyRules,
        projectSources: this.projectSources,
        projectContext: context,
      }),
    };
  }

  getSources(): ReadonlyMap<string, string> {
    return this.projectSources;
  }

  getProjectContext(): ProjectContext | undefined {
    return this.projectContext;
  }

  private refreshIfNeeded(config: BsprettierConfig): void {
    const nextSignature = sourceSetSignature(config);
    if (!this.projectContext || this.signature !== nextSignature) {
      this.refresh(config);
    }
  }

  private replaceSources(sources: Map<string, string>): void {
    this.projectSources = sources;
    this.projectContext = getProjectContext(this.projectSources);
  }

  private formatSingleFile(request: WorkspaceDocument): FormatFileResult {
    return formatSingleFileForEditor({
      filePath: request.filePath,
      source: request.source,
      configPath: this.configPath,
      cwd: this.cwd,
      onlyRules: this.onlyRules,
    });
  }

  private loadConfigFor(filePath: string): BsprettierConfig {
    return loadEditorConfig({
      filePath,
      configPath: this.configPath,
      cwd: this.cwd,
    });
  }
}
