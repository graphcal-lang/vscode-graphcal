// "Graphcal: Apply Changes from Clipboard": the what-if edits copied from the
// web view (a unified diff) go into the workspace's files as one undoable
// edit. Each file is found by its repository path under exactly one workspace
// folder, or by the longest unique suffix of it; each hunk by its context. A
// patch that is malformed or names a path outside the workspace changes
// nothing.
import * as vscode from "vscode";
import { locateHunks, parsePatch, type FilePatch } from "./patch";
import { pathSegments, uniqueMatch, type Match } from "./patchPath";

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * The workspace file a patch path names: exact under one folder, else a
 * unique suffix match. The segments are checked (see `pathSegments`), so the
 * exact candidates stay inside their folders.
 */
async function locateFile(segments: readonly string[]): Promise<Match<vscode.Uri>> {
  const exact: vscode.Uri[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const uri = vscode.Uri.joinPath(folder.uri, ...segments);
    if (await exists(uri)) exact.push(uri);
  }
  if (exact.length > 0) return uniqueMatch(exact);
  for (let i = 1; i < segments.length; i += 1) {
    const suffix = segments.slice(i).join("/");
    const found = await vscode.workspace.findFiles(`**/${suffix}`, "**/node_modules/**", 2);
    const match = uniqueMatch(found);
    if (match.kind !== "missing") return match;
  }
  return { kind: "missing" };
}

/** Add the edits for one file to `edit`; the report says what happened, `uri` where. */
async function planFile(
  patch: FilePatch,
  segments: readonly string[],
  edit: vscode.WorkspaceEdit,
): Promise<{ report: string; uri: vscode.Uri | null }> {
  const match = await locateFile(segments);
  if (match.kind === "missing") return { report: `${patch.path}: not in the workspace`, uri: null };
  if (match.kind === "ambiguous") {
    return { report: `${patch.path}: matches several files`, uri: null };
  }
  const uri = match.value;
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
  const report =
    failed === 0
      ? `${name}: ${applied}`
      : `${name}: ${applied}, ${failed} not found (the file differs from what the web view read)`;
  return { report, uri };
}

export async function applyChangesFromClipboard(): Promise<void> {
  const text = await vscode.env.clipboard.readText();
  const parsed = parsePatch(text);
  if (!parsed.ok) {
    void vscode.window.showErrorMessage(
      `Graphcal: the clipboard's patch is incomplete or malformed (${parsed.error}); nothing was applied.`,
    );
    return;
  }
  if (parsed.files.length === 0) {
    void vscode.window.showWarningMessage(
      "The clipboard holds no unified diff. In the Graphcal web view, click “copy changes” first.",
    );
    return;
  }
  const targets = parsed.files.map((patch) => ({ patch, path: pathSegments(patch.path) }));
  const refused = targets.flatMap(({ patch, path }) =>
    path.ok ? [] : [`${patch.path}: ${path.error}`],
  );
  if (refused.length > 0) {
    void vscode.window.showErrorMessage(
      `Graphcal: the patch names files outside the workspace; nothing was applied. ${refused.join(" · ")}`,
    );
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  const planned: { report: string; uri: vscode.Uri | null }[] = [];
  for (const { patch, path } of targets) {
    if (path.ok) planned.push(await planFile(patch, path.segments, edit));
  }
  const ok = await vscode.workspace.applyEdit(edit);
  const summary = planned.map((p) => p.report).join(" · ");
  if (!ok) {
    void vscode.window.showErrorMessage(`Graphcal: the changes could not be applied. ${summary}`);
    return;
  }
  const first = planned[0]?.uri;
  if (first) await vscode.window.showTextDocument(first, { preview: false });
  void vscode.window.showInformationMessage(`Graphcal: applied from the clipboard. ${summary}`);
}
