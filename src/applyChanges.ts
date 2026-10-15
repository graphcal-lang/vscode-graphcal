// "Graphcal: Apply Changes from Clipboard": the what-if edits copied from the
// web view (a unified diff) go into the workspace's files as one undoable
// edit. Each file is found by its repository path under a workspace folder,
// or by the longest unique suffix of it; each hunk by its context.
import * as vscode from "vscode";
import { locateHunks, parsePatch, type FilePatch } from "./patch";

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** The workspace file a patch path names: exact under a folder, else a unique suffix match. */
async function locateFile(path: string): Promise<vscode.Uri | "ambiguous" | null> {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const uri = vscode.Uri.joinPath(folder.uri, path);
    if (await exists(uri)) return uri;
  }
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    const suffix = parts.slice(i).join("/");
    const found = await vscode.workspace.findFiles(`**/${suffix}`, "**/node_modules/**", 2);
    if (found.length === 1) return found[0] ?? null;
    if (found.length > 1) return "ambiguous";
  }
  return null;
}

/** Add the edits for one file to `edit`; the report line says what happened. */
async function planFile(patch: FilePatch, edit: vscode.WorkspaceEdit): Promise<string> {
  const uri = await locateFile(patch.path);
  if (uri === null) return `${patch.path}: not in the workspace`;
  if (uri === "ambiguous") return `${patch.path}: matches several files`;
  const document = await vscode.workspace.openTextDocument(uri);
  const { edits, failed } = locateHunks(document.getText(), patch);
  for (const lineEdit of edits) {
    const start = new vscode.Position(lineEdit.start, 0);
    // The end of the replaced lines: the start of the next line, or the end of the document.
    const end =
      lineEdit.end < document.lineCount
        ? new vscode.Position(lineEdit.end, 0)
        : document.lineAt(document.lineCount - 1).range.end;
    const text =
      lineEdit.end < document.lineCount
        ? lineEdit.lines.map((l) => `${l}\n`).join("")
        : lineEdit.lines.join("\n");
    edit.replace(uri, new vscode.Range(start, end), text);
  }
  const name = vscode.workspace.asRelativePath(uri);
  const applied = `${edits.length} ${edits.length === 1 ? "change" : "changes"}`;
  return failed === 0
    ? `${name}: ${applied}`
    : `${name}: ${applied}, ${failed} not found (the file differs from what the web view read)`;
}

export async function applyChangesFromClipboard(): Promise<void> {
  const text = await vscode.env.clipboard.readText();
  const patches = parsePatch(text);
  if (patches.length === 0) {
    void vscode.window.showWarningMessage(
      "The clipboard holds no unified diff. In the Graphcal web view, click “copy changes” first.",
    );
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  const report: string[] = [];
  for (const patch of patches) report.push(await planFile(patch, edit));
  const ok = await vscode.workspace.applyEdit(edit);
  const summary = report.join(" · ");
  if (!ok) {
    void vscode.window.showErrorMessage(`Graphcal: the changes could not be applied. ${summary}`);
    return;
  }
  const first = patches[0];
  if (first) {
    const uri = await locateFile(first.path);
    if (uri !== null && uri !== "ambiguous") {
      await vscode.window.showTextDocument(uri, { preview: false });
    }
  }
  void vscode.window.showInformationMessage(`Graphcal: applied from the clipboard. ${summary}`);
}
