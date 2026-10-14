// The Graphcal view: a webview panel showing the active `.gcl` file as the
// sheet the language server projects for it. The panel loads the view bundle
// built from graphcal/web/view (media/view), asks the server for the file's
// view model, re-asks whenever the server announces a fresh analysis, and
// turns the view's edits into edits of the editor's documents.
import * as vscode from "vscode";
import type { LanguageClient, StaticFeature } from "vscode-languageclient/node";

const VIEW_MODEL_REQUEST = "graphcal/viewModel";
const VIEW_MODEL_CHANGED = "graphcal/viewModelDidChange";

/** What the webview sends. */
type FromView =
  | { type: "ready" }
  | { type: "edit"; file: string; start: number; end: number; text: string }
  | { type: "request"; module: string };

/** What the webview receives. */
type ToView =
  | { type: "model"; model: ViewModel; sources: Record<string, string>; main: boolean }
  | { type: "note"; message: string | null };

/** The parts of the server's view model the extension reads. */
interface ViewModel {
  module: { id: string; file: string; package: string };
  nodes: { source: { file: string | null } | null }[];
}

/** Opts the client into `graphcal/viewModelDidChange` notifications. */
export function viewModelFeature(): StaticFeature {
  return {
    fillClientCapabilities(capabilities) {
      const experimental = (capabilities.experimental ?? {}) as Record<string, unknown>;
      const graphcal = (experimental.graphcal ?? {}) as Record<string, unknown>;
      capabilities.experimental = {
        ...experimental,
        graphcal: { ...graphcal, viewModelChanges: true },
      };
    },
    initialize() {},
    getState() {
      return { kind: "static" };
    },
    clear() {},
  };
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** The directory `graphcal.toml` lives in, walking up from the file; else the file's own. */
async function projectRootOf(file: vscode.Uri): Promise<vscode.Uri> {
  const own = vscode.Uri.joinPath(file, "..");
  let dir = own;
  for (;;) {
    if (await exists(vscode.Uri.joinPath(dir, "graphcal.toml"))) return dir;
    const parent = vscode.Uri.joinPath(dir, "..");
    if (parent.toString() === dir.toString()) return own;
    dir = parent;
  }
}

/** `power_project.eps` is `src/power_project/eps.gcl` under the project root. */
function fileOfModule(root: vscode.Uri, module: string): vscode.Uri {
  const segments = module.split(".");
  const leaf = segments.pop() ?? module;
  return vscode.Uri.joinPath(root, "src", ...segments, `${leaf}.gcl`);
}

export class GraphcalView {
  private panel: vscode.WebviewPanel | null = null;
  private client: LanguageClient | null = null;
  /** The document shown as the main sheet. */
  private main: vscode.Uri | null = null;
  /** Documents whose models the view asked for, by uri string. */
  private readonly wanted = new Set<string>();
  private ready = false;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Listen to the server once it is running. */
  attach(client: LanguageClient): void {
    this.client = client;
    this.context.subscriptions.push(
      client.onNotification(VIEW_MODEL_CHANGED, (params: { uri: string }) => {
        if (!this.panel) return;
        const uri = vscode.Uri.parse(params.uri);
        if (this.main?.toString() === uri.toString()) void this.push(uri, true);
        else if (this.wanted.has(uri.toString())) void this.push(uri, false);
      }),
    );
  }

  /** Open the panel beside the editor for the active `.gcl` file. */
  open(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.languageId === "graphcal") this.main = editor.document.uri;
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
      if (this.main && this.ready) void this.push(this.main, true);
      return;
    }
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media", "view");
    const panel = vscode.window.createWebviewPanel(
      "graphcal.view",
      "Graphcal View",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [media], retainContextWhenHidden: true },
    );
    this.panel = panel;
    this.ready = false;
    panel.webview.html = this.html(panel.webview, media);
    panel.webview.onDidReceiveMessage((message: FromView) => void this.receive(message));
    panel.onDidDispose(() => {
      this.panel = null;
      this.ready = false;
      this.wanted.clear();
    });
  }

  /** Follow the editor: a `.gcl` file brought to front becomes the main sheet. */
  follow(editor: vscode.TextEditor | undefined): void {
    if (!this.panel || !editor || editor.document.languageId !== "graphcal") return;
    if (this.main?.toString() === editor.document.uri.toString()) return;
    this.main = editor.document.uri;
    if (this.ready) void this.push(this.main, true);
  }

  private async receive(message: FromView): Promise<void> {
    switch (message.type) {
      case "ready":
        this.ready = true;
        if (this.main) await this.push(this.main, true);
        return;
      case "edit":
        await this.applyEdit(message);
        return;
      case "request":
        await this.request(message.module);
        return;
      default:
        return;
    }
  }

  /** Ask the server for a document's model and hand it to the view with its sources. */
  private async push(uri: vscode.Uri, main: boolean): Promise<void> {
    if (!this.panel) return;
    if (!this.client) {
      this.post({ type: "note", message: "the Graphcal language server is not running" });
      return;
    }
    let model: ViewModel | null;
    try {
      model = await this.client.sendRequest<ViewModel | null>(VIEW_MODEL_REQUEST, {
        textDocument: { uri: uri.toString() },
      });
    } catch (error) {
      // An older graphcal has no graphcal/viewModel; say so instead of staying at "loading…".
      const why = error instanceof Error ? error.message : String(error);
      this.post({
        type: "note",
        message: `the language server could not provide the view (${why}); is graphcal up to date?`,
      });
      return;
    }
    if (model === null) {
      if (main)
        this.post({ type: "note", message: "not analyzed yet, or the file does not compile" });
      return;
    }
    const root = await projectRootOf(uri);
    const files = new Set<string>([model.module.file]);
    for (const node of model.nodes) if (node.source?.file) files.add(node.source.file);
    const sources: Record<string, string> = {};
    for (const file of files) {
      try {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, file));
        sources[file] = document.getText();
      } catch {
        // A file the project did not load has nothing to edit.
      }
    }
    this.post({ type: "model", model, sources, main });
  }

  /** Replace a span of a project file: the editor's document changes, the server re-analyzes. */
  private async applyEdit(edit: {
    file: string;
    start: number;
    end: number;
    text: string;
  }): Promise<void> {
    if (!this.main) return;
    const root = await projectRootOf(this.main);
    const uri = vscode.Uri.joinPath(root, edit.file);
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      this.post({ type: "note", message: `cannot open ${edit.file}` });
      return;
    }
    const change = new vscode.WorkspaceEdit();
    change.replace(
      uri,
      new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)),
      edit.text,
    );
    if (!(await vscode.workspace.applyEdit(change))) {
      this.post({ type: "note", message: `could not edit ${edit.file}` });
    }
  }

  /** Open a module's file so the server analyzes it; its model follows the server's announcement. */
  private async request(module: string): Promise<void> {
    if (!this.main) return;
    const uri = fileOfModule(await projectRootOf(this.main), module);
    this.wanted.add(uri.toString());
    try {
      await vscode.workspace.openTextDocument(uri);
    } catch {
      this.wanted.delete(uri.toString());
      return;
    }
    await this.push(uri, false);
  }

  private post(message: ToView): void {
    void this.panel?.webview.postMessage(message);
  }

  /** The page: the bundle brings the view's markup with it, so the body holds only the script. */
  private html(webview: vscode.Webview, media: vscode.Uri): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(media, "view.js")).toString();
    const style = webview.asWebviewUri(vscode.Uri.joinPath(media, "view.css")).toString();
    const nonce = Array.from({ length: 24 }, () =>
      Math.floor(Math.random() * 36).toString(36),
    ).join("");
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join("; ");
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Graphcal View</title>
    <link rel="stylesheet" href="${style}" />
  </head>
  <body>
    <script type="module" nonce="${nonce}" src="${script}"></script>
  </body>
</html>`;
  }
}
