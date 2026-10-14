// A stand-in for the `vscode` module, enough for the view and the clipboard
// command: files live in `state.files` by path, edits change them there, and
// what the extension shows or posts lands in `state.posted`. A test mocks
// `vscode` with `vscode` from here and arranges `state` before each case.

export const state = {
  files: new Map<string, string>(),
  folders: [] as string[],
  clipboard: "",
  active: null as unknown,
  /** Messages posted to the webview, and the messages the extension showed. */
  posted: [] as { type: string; [key: string]: unknown }[],
  /** The webview's message listener, once a panel exists. */
  receive: null as ((message: unknown) => void) | null,
  /** Delays (ms) for the next `openTextDocument` calls, in order. */
  openDelays: [] as number[],
};

export function reset(): void {
  state.files.clear();
  state.folders = [];
  state.clipboard = "";
  state.active = null;
  state.posted = [];
  state.receive = null;
  state.openDelays = [];
}

/** `path.posix.join`, which the tests cannot import (no Node types here). */
function join(...paths: string[]): string {
  const absolute = paths[0]?.startsWith("/") ?? false;
  const segments: string[] = [];
  for (const segment of paths.join("/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === ".." && segments.length > 0) segments.pop();
    else if (segment !== ".." || !absolute) segments.push(segment);
  }
  return absolute ? `/${segments.join("/")}` : segments.join("/") || ".";
}

class Uri {
  constructor(
    readonly scheme: string,
    readonly path: string,
  ) {}
  toString(): string {
    return this.scheme === "file" ? `file://${this.path}` : `${this.scheme}:${this.path}`;
  }
  static file(path: string): Uri {
    return new Uri("file", path);
  }
  static parse(value: string): Uri {
    if (value.startsWith("file://")) return new Uri("file", value.slice("file://".length));
    const colon = value.indexOf(":");
    return new Uri(value.slice(0, colon), value.slice(colon + 1));
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri(base.scheme, join(base.path, ...parts));
  }
}

class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}

class Range {
  constructor(
    readonly start: Position,
    readonly end: Position,
  ) {}
}

class WorkspaceEdit {
  readonly entries: { uri: Uri; range: Range; text: string }[] = [];
  replace(uri: Uri, range: Range, text: string): void {
    this.entries.push({ uri, range, text });
  }
}

function offsetAt(text: string, position: Position): number {
  const lines = text.split("\n").slice(0, position.line);
  return lines.reduce((n, line) => n + line.length + 1, 0) + position.character;
}

function document(uri: Uri) {
  const text = state.files.get(uri.path);
  if (text === undefined) throw new Error(`no file ${uri.path}`);
  const lines = text.split("\n");
  return {
    uri,
    languageId: "graphcal",
    lineCount: lines.length,
    getText: () => text,
    lineAt: (line: number) => ({
      range: { end: new Position(line, lines[line]?.length ?? 0) },
    }),
    positionAt(offset: number): Position {
      const before = text.slice(0, offset).split("\n");
      return new Position(before.length - 1, before[before.length - 1]?.length ?? 0);
    },
  };
}

export const vscode = {
  Uri,
  Position,
  Range,
  WorkspaceEdit,
  ViewColumn: { Beside: 2 },
  env: { clipboard: { readText: async () => state.clipboard } },
  workspace: {
    get workspaceFolders() {
      return state.folders.map((path) => ({ uri: Uri.file(path) }));
    },
    fs: {
      stat: async (uri: Uri) => {
        if (!state.files.has(uri.path)) throw new Error(`no file ${uri.path}`);
        return {};
      },
    },
    findFiles: async () => [],
    asRelativePath: (uri: Uri) => uri.path,
    openTextDocument: async (uri: Uri) => {
      const delay = state.openDelays.shift() ?? 0;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      return document(uri);
    },
    applyEdit: async (edit: WorkspaceEdit) => {
      for (const { uri, range, text } of edit.entries) {
        const before = state.files.get(uri.path) ?? "";
        const start = offsetAt(before, range.start);
        const end = offsetAt(before, range.end);
        state.files.set(uri.path, before.slice(0, start) + text + before.slice(end));
      }
      return true;
    },
  },
  window: {
    get activeTextEditor() {
      return state.active;
    },
    showErrorMessage: async (message: string) => {
      state.posted.push({ type: "error", message });
    },
    showWarningMessage: async (message: string) => {
      state.posted.push({ type: "warning", message });
    },
    showInformationMessage: async (message: string) => {
      state.posted.push({ type: "information", message });
    },
    showTextDocument: async () => undefined,
    createWebviewPanel: () => ({
      reveal() {},
      onDidDispose() {},
      webview: {
        html: "",
        cspSource: "test:",
        asWebviewUri: (uri: Uri) => uri,
        onDidReceiveMessage(listener: (message: unknown) => void) {
          state.receive = listener;
        },
        postMessage: async (message: { type: string }) => {
          state.posted.push(message);
          return true;
        },
      },
    }),
  },
};
