import * as vscode from "vscode";
import {
  WorkspaceFormatService,
  type EditorFormatMode,
  type WorkspaceFormatResponse,
} from "@dreamsocket/bsprettier";

type ServiceEntry = {
  service: WorkspaceFormatService;
  disposables: vscode.Disposable[];
};

const supportedLanguages = new Set(["brightscript", "brighterscript", "xml"]);

const services = new Map<string, ServiceEntry>();
let output: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("bsprettier");
  context.subscriptions.push(output);
  output.appendLine("bsprettier extension activated");

  const provider = vscode.languages.registerDocumentFormattingEditProvider(
    ["brightscript", "brighterscript", "xml"],
    {
      provideDocumentFormattingEdits(document) {
        return formatDocument(document);
      },
    },
  );
  context.subscriptions.push(provider);

  context.subscriptions.push(
    vscode.commands.registerCommand("bsprettier.formatDocument", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const edits = await formatDocument(editor.document);
      if (edits.length === 0) return;
      await editor.edit((builder) => {
        for (const edit of edits) {
          builder.replace(edit.range, edit.newText);
        }
      });
    }),
  );

  // Red Hat (or another extension) owns the `xml` default formatter, so
  // format-on-save never routes plain XML through us. To still apply
  // bsprettier's Roku-specific passes on save, register a save participant that
  // runs only on component XML and chains on top of the default formatter.
  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument((event) => {
      const document = event.document;
      if (document.languageId !== "xml") return;
      // Honor editor.formatOnSave (respecting any [xml] language override) so
      // this pass is enabled/disabled by the same setting as the built-in
      // formatter.
      const formatOnSave = vscode.workspace
        .getConfiguration("editor", {
          uri: document.uri,
          languageId: document.languageId,
        })
        .get<boolean>("formatOnSave", false);
      if (!formatOnSave) return;
      // Mirror editor.formatOnSave: skip the periodic afterDelay autosave so we
      // don't reformat mid-edit. Manual (Cmd+S) and focus/window-change saves
      // still run.
      if (event.reason === vscode.TextDocumentSaveReason.AfterDelay) return;
      if (!isRokuComponent(document.getText())) return;
      trace(
        `onWillSave: component XML detected, queuing bsprettier pass for ${document.uri.fsPath}`,
      );
      event.waitUntil(formatDocument(document));
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      for (const folder of event.removed) disposeService(folder.uri.fsPath);
    }),
  );
}

function isRokuComponent(source: string): boolean {
  return /<component[\s>]/i.test(source);
}

// Routine, per-format diagnostics. Gated behind `bsprettier.trace` so the output
// channel stays quiet in normal use; genuine errors/fallbacks always log.
function trace(message: string): void {
  if (vscode.workspace.getConfiguration("bsprettier").get<boolean>("trace", false)) {
    output.appendLine(message);
  }
}

export function deactivate(): void {
  for (const key of [...services.keys()]) disposeService(key);
}

async function formatDocument(
  document: vscode.TextDocument,
): Promise<vscode.TextEdit[]> {
  const startedAt = Date.now();
  trace(
    `formatDocument invoked: ${document.uri.fsPath || document.uri.toString()} (languageId=${document.languageId})`,
  );
  if (!supportedLanguages.has(document.languageId)) return [];
  if (!document.uri.fsPath) {
    output.appendLine(`Cannot format ${document.uri.toString()}: no filesystem path`);
    return [];
  }

  const config = vscode.workspace.getConfiguration("bsprettier", document.uri);
  const mode = config.get<EditorFormatMode>("editor.mode", "project");
  const configPath = config.get<string | null>("configPath", null) ?? undefined;
  const source = document.getText();
  const filePath = document.uri.fsPath;

  let response: WorkspaceFormatResponse;
  if (mode === "singleFile") {
    const workspace = workspaceFolderFor(document);
    const service = serviceFor(workspace, configPath).service;
    response = service.format({ mode: "singleFile", filePath, source });
  } else {
    const workspace = workspaceFolderFor(document);
    const service = serviceFor(workspace, configPath).service;
    response = service.format({ mode: "project", filePath, source });
  }

  if (response.degradedReason) {
    output.appendLine(
      `Fell back to single-file formatting for ${filePath}: ${response.degradedReason}`,
    );
  }

  if (
    response.result.status === "parse-error" ||
    response.result.status === "conflict"
  ) {
    output.appendLine(
      `Could not format ${filePath}: ${response.result.errorMessage ?? response.result.status}`,
    );
    return [];
  }

  const elapsed = Date.now() - startedAt;
  if (!response.result.changed) {
    trace(`No changes for ${filePath} (${elapsed}ms)`);
    return [];
  }
  trace(`Produced edits for ${filePath} (${elapsed}ms)`);
  return [
    vscode.TextEdit.replace(
      fullDocumentRange(document),
      response.result.output,
    ),
  ];
}

function serviceFor(
  folder: vscode.WorkspaceFolder | undefined,
  configPath: string | undefined,
): ServiceEntry {
  const cwd = folder?.uri.fsPath ?? process.cwd();
  const key = `${cwd}\0${configPath ?? ""}`;
  const existing = services.get(key);
  if (existing) return existing;

  const service = new WorkspaceFormatService({ cwd, configPath });
  const disposables: vscode.Disposable[] = [];
  const pattern = new vscode.RelativePattern(folder ?? cwd, "**/*.{brs,bs,xml}");
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  disposables.push(
    watcher,
    watcher.onDidDelete((uri) => service.removeDocument(uri.fsPath)),
    watcher.onDidChange((uri) => refreshDocumentSource(service, uri)),
    watcher.onDidCreate((uri) => refreshDocumentSource(service, uri)),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.scheme !== "file") return;
      if (!supportedLanguages.has(event.document.languageId)) return;
      service.updateDocument({
        filePath: event.document.uri.fsPath,
        source: event.document.getText(),
      });
    }),
  );

  const entry = { service, disposables };
  services.set(key, entry);
  return entry;
}

function disposeService(key: string): void {
  for (const [serviceKey, entry] of services) {
    if (!serviceKey.startsWith(`${key}\0`)) continue;
    for (const disposable of entry.disposables) disposable.dispose();
    services.delete(serviceKey);
  }
}

function workspaceFolderFor(
  document: vscode.TextDocument,
): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder(document.uri);
}

async function refreshDocumentSource(
  service: WorkspaceFormatService,
  uri: vscode.Uri,
): Promise<void> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    service.updateDocument({
      filePath: uri.fsPath,
      source: Buffer.from(bytes).toString("utf8"),
    });
  } catch {
    service.removeDocument(uri.fsPath);
  }
}

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
  const lastLine = document.lineAt(Math.max(document.lineCount - 1, 0));
  return new vscode.Range(
    new vscode.Position(0, 0),
    lastLine.rangeIncludingLineBreak.end,
  );
}
