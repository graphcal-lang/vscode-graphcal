// The Graphcal view: a webview panel showing the active `.gcl` file as the
// sheet the language server projects for it. The panel loads the view bundle
// built from graphcal/web/view (media/view), asks the server for the file's
// view model, re-asks whenever the server announces a fresh analysis, and
// turns the view's edits into edits of the editor's documents.
//
// The webview edits its copy of a file and sends the change as offsets on
// that copy. Every copy goes out with its project and a revision; an edit
// goes to the document that copy was read from, and only while the copy is
// the latest sent and the document still reads the same (see viewSync.ts).
// Whatever sends copies or edits a document runs one task at a time.
import * as vscode from "vscode";
import type { LanguageClient, StaticFeature } from "vscode-languageclient/node";
import {
  checkEdit,
  heldKey,
  isModulePath,
  parseFromView,
  type EditMessage,
  type Held,
} from "./viewSync";

const VIEW_MODEL_REQUEST = "graphcal/viewModel";
const VIEW_MODEL_CHANGED = "graphcal/viewModelDidChange";

/** What the webview receives. */
type ToView =
  | {
      type: "model";
      model: ViewModel;
      /** The project root the model's file paths are relative to, as a uri. */
      project: string;
      sources: Record<string, string>;
      /** The revision of these copies, which edits made on them name. */
      revision: number;
      main: boolean;
    }
  | { type: "edited"; id: number; ok: true }
  | { type: "edited"; id: number; ok: false; message: string }
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
  // Only a file path is sure to reach a root: an untitled one is relative and climbs forever.
  if (file.scheme !== "file") return own;
  let dir = own;
  for (;;) {
    if (await exists(vscode.Uri.joinPath(dir, "graphcal.toml"))) return dir;
    const parent = vscode.Uri.joinPath(dir, "..");
    if (parent.toString() === dir.toString()) return own;
    dir = parent;
  }
}

/** Whether the view shows `document`: a `.gcl` file on disk, as the language server reads them. */
function viewable(document: vscode.TextDocument): boolean {
  return document.languageId === "graphcal" && document.uri.scheme === "file";
}

/** `power_project.eps` is `src/power_project/eps.gcl` under the project root. */
function fileOfModule(root: vscode.Uri, module: string): vscode.Uri {
  const segments = module.split(".");
  const leaf = segments.pop() ?? module;
  return vscode.Uri.joinPath(root, "src", ...segments, `${leaf}.gcl`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One open panel: the copies its webview holds and the work in flight for it. */
class Session {
  /** The files the webview holds, by `heldKey`. */
  readonly held = new Map<string, Held<vscode.Uri>>();
  /** Documents whose models the view asked for, by uri string. */
  readonly wanted = new Set<string>();
  ready = false;
  disposed = false;
  private revisions = 0;
  private pushes = 0;
  /** The newest push to each target ("main" or a uri): an older answer must not overwrite it. */
  private readonly latest = new Map<string, number>();
  private queue: Promise<void> = Promise.resolve();

  constructor(readonly panel: vscode.WebviewPanel) {}

  /** Run `task` once every task before it has finished; a failure is said in the view. */
  serial(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task).catch((error: unknown) => {
      this.post({ type: "note", message: messageOf(error) });
    });
    return this.queue;
  }

  post(message: ToView): void {
    if (!this.disposed) void this.panel.webview.postMessage(message);
  }

  /** A ticket for a push to `target`, current until the next push to the same target. */
  issue(target: string): number {
    this.pushes += 1;
    this.latest.set(target, this.pushes);
    return this.pushes;
  }

  isCurrent(target: string, ticket: number): boolean {
    return !this.disposed && this.latest.get(target) === ticket;
  }

  nextRevision(): number {
    this.revisions += 1;
    return this.revisions;
  }
}

export class GraphcalView {
  private session: Session | null = null;
  private client: LanguageClient | null = null;
  /** The document shown as the main sheet. */
  private main: vscode.Uri | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Listen to the server once it is running. */
  attach(client: LanguageClient): void {
    this.client = client;
    this.context.subscriptions.push(
      client.onNotification(VIEW_MODEL_CHANGED, (params: { uri: string }) => {
        const session = this.session;
        if (!session) return;
        const uri = vscode.Uri.parse(params.uri);
        if (this.main?.toString() === uri.toString()) void this.push(session, uri, true);
        else if (session.wanted.has(uri.toString())) void this.push(session, uri, false);
      }),
    );
  }

  /** Open the panel beside the editor for the active `.gcl` file. */
  open(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor && viewable(editor.document)) this.main = editor.document.uri;
    const existing = this.session;
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside, true);
      if (existing.ready) this.showMain(existing);
      return;
    }
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media", "view");
    const panel = vscode.window.createWebviewPanel(
      "graphcal.view",
      "Graphcal View",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [media], retainContextWhenHidden: true },
    );
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "icons", "graphcal.svg");
    const session = new Session(panel);
    this.session = session;
    panel.webview.html = this.html(panel.webview, media);
    panel.webview.onDidReceiveMessage((message: unknown) => this.receive(session, message));
    panel.onDidDispose(() => {
      session.disposed = true;
      if (this.session === session) this.session = null;
    });
  }

  /** Follow the editor: a `.gcl` file brought to front becomes the main sheet. */
  follow(editor: vscode.TextEditor | undefined): void {
    const session = this.session;
    if (!session || !editor || !viewable(editor.document)) return;
    if (this.main?.toString() === editor.document.uri.toString()) return;
    this.main = editor.document.uri;
    if (session.ready) this.showMain(session);
  }

  /** Push the main sheet, or say that there is none. */
  private showMain(session: Session): void {
    if (this.main) void this.push(session, this.main, true);
    else session.post({ type: "note", message: "open a .gcl file to show it here" });
  }

  private receive(session: Session, raw: unknown): void {
    const message = parseFromView(raw);
    if (message === null) {
      // Answer an edit even when it is malformed: the view waits for the answer.
      const id = typeof raw === "object" && raw !== null ? (raw as { id?: unknown }).id : null;
      if (typeof id === "number") {
        session.post({ type: "edited", id, ok: false, message: "the view sent a malformed edit" });
      }
      return;
    }
    switch (message.type) {
      case "ready":
        session.ready = true;
        this.showMain(session);
        return;
      case "edit":
        void session.serial(async () => {
          try {
            await this.applyEdit(session, message);
          } catch (error) {
            session.post({ type: "edited", id: message.id, ok: false, message: messageOf(error) });
          }
        });
        return;
      case "request":
        void this.request(session, message.module);
        return;
      default:
        return;
    }
  }

  /** Ask the server for a document's model and hand it to the view with its sources. */
  private async push(session: Session, uri: vscode.Uri, main: boolean): Promise<void> {
    const target = main ? "main" : uri.toString();
    const ticket = session.issue(target);
    if (!this.client) {
      session.post({ type: "note", message: "the Graphcal language server is not running" });
      return;
    }
    let model: ViewModel | null;
    try {
      model = await this.client.sendRequest<ViewModel | null>(VIEW_MODEL_REQUEST, {
        textDocument: { uri: uri.toString() },
      });
    } catch (error) {
      if (!session.isCurrent(target, ticket)) return;
      // An older graphcal has no graphcal/viewModel; say so instead of staying at "loading…".
      session.post({
        type: "note",
        message: `the language server could not provide the view (${messageOf(error)}); is graphcal up to date?`,
      });
      return;
    }
    /** Whether this answer still has the say: no newer push, and still the main sheet if it is one. */
    const stillCurrent = (): boolean =>
      session.isCurrent(target, ticket) && (!main || this.main?.toString() === uri.toString());
    await session.serial(async () => {
      if (!stillCurrent()) return;
      if (model === null) {
        if (main) {
          session.post({ type: "note", message: "not analyzed yet, or the file does not compile" });
        }
        return;
      }
      const root = await projectRootOf(uri);
      const files = new Set<string>([model.module.file]);
      for (const node of model.nodes) if (node.source?.file) files.add(node.source.file);
      const read: { file: string; uri: vscode.Uri; text: string }[] = [];
      for (const file of files) {
        try {
          const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, file));
          read.push({ file, uri: document.uri, text: document.getText() });
        } catch {
          // A file the project did not load has nothing to edit.
        }
      }
      // The editor may have switched files while they were read.
      if (!stillCurrent()) return;
      const project = root.toString();
      const revision = session.nextRevision();
      const sources: Record<string, string> = {};
      for (const { file, uri: document, text } of read) {
        sources[file] = text;
        session.held.set(heldKey(project, file), { uri: document, text, revision });
      }
      session.post({ type: "model", model, project, sources, revision, main });
    });
  }

  /** Send the webview fresh copies of what it shows. */
  private resync(session: Session): void {
    if (this.main) void this.push(session, this.main, true);
    for (const uri of session.wanted) void this.push(session, vscode.Uri.parse(uri), false);
  }

  /**
   * Replace a span of the file the webview's copy was read from, if that copy
   * is still the document's text; the server then re-analyzes. The webview
   * waits for the `edited` answer before it takes the edit into its copy.
   */
  private async applyEdit(session: Session, edit: EditMessage): Promise<void> {
    const refuse = (message: string, resync: boolean): void => {
      session.post({ type: "edited", id: edit.id, ok: false, message });
      if (resync) this.resync(session);
    };
    const held = session.held.get(heldKey(edit.project, edit.file));
    if (held === undefined) {
      refuse(`the view has no copy of ${edit.file} to edit`, false);
      return;
    }
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(held.uri);
    } catch {
      refuse(`cannot open ${edit.file}`, false);
      return;
    }
    const check = checkEdit(held, edit, document.getText());
    if (!check.ok) {
      refuse(check.message, check.resync);
      return;
    }
    const change = new vscode.WorkspaceEdit();
    change.replace(
      held.uri,
      new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)),
      edit.text,
    );
    if (!(await vscode.workspace.applyEdit(change))) {
      refuse(`could not edit ${edit.file}`, true);
      return;
    }
    // The webview's copy is now the edited text. Should the document read
    // otherwise (it normalized line endings, say), the next edit's check
    // finds the difference and refreshes the copy.
    held.text = check.next;
    session.post({ type: "edited", id: edit.id, ok: true });
  }

  /** Open a module's file so the server analyzes it; its model follows the server's announcement. */
  private async request(session: Session, module: string): Promise<void> {
    if (!this.main || !isModulePath(module)) return;
    const uri = fileOfModule(await projectRootOf(this.main), module);
    session.wanted.add(uri.toString());
    try {
      await vscode.workspace.openTextDocument(uri);
    } catch {
      session.wanted.delete(uri.toString());
      return;
    }
    await this.push(session, uri, false);
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
