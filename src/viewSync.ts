// What the extension and the Graphcal view agree on about the files the view
// edits: the messages the webview may send, the copy of each file it holds,
// and whether an edit it made on that copy still fits the document. Pure
// functions: view.ts does the IO.

/** What the webview sends. */
export type FromView =
  | { type: "ready" }
  | {
      type: "edit";
      /** Echoed in the `edited` reply. */
      id: number;
      /** The project the edited model came from, as the `model` message named it. */
      project: string;
      /** The file, relative to the project root. */
      file: string;
      /** The revision of the copy the offsets are on: the copy as last sent, or as the last applied edit left it. */
      revision: number;
      start: number;
      end: number;
      text: string;
    }
  /** The model of a target the view has none of yet. */
  | { type: "request"; target: ViewTarget };

/**
 * What the view shows: a module alone, or one include instance (an opaque id)
 * of the module `root`, as the language server projects it from `root`'s
 * analysis.
 */
export type ViewTarget =
  | { kind: "module"; module: string }
  | { kind: "instance"; root: string; instance: string };

/** The `target` of a `graphcal/viewModel` request on the target's root document. */
export type ServerTarget = { kind: "module" } | { kind: "instance"; instance: string };

/** The module whose document the server projects `target` from. */
export function rootModule(target: ViewTarget): string {
  return target.kind === "module" ? target.module : target.root;
}

/** The request `target` of `target`, on its root module's document. */
export function serverTarget(target: ViewTarget): ServerTarget {
  return target.kind === "module"
    ? { kind: "module" }
    : { kind: "instance", instance: target.instance };
}

/** The key of a target asked of one document: a document may be asked for several. */
export function wantedKey(uri: string, target: ServerTarget): string {
  return JSON.stringify(target.kind === "module" ? [uri] : [uri, target.instance]);
}

function parseTarget(raw: unknown): ViewTarget | null {
  if (typeof raw !== "object" || raw === null) return null;
  const t = raw as Record<string, unknown>;
  if (t.kind === "module" && typeof t.module === "string") {
    return { kind: "module", module: t.module };
  }
  if (t.kind === "instance" && typeof t.root === "string" && typeof t.instance === "string") {
    return { kind: "instance", root: t.root, instance: t.instance };
  }
  return null;
}

export type EditMessage = Extract<FromView, { type: "edit" }>;

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** A message from the webview, checked field by field; null when it is not one. */
export function parseFromView(message: unknown): FromView | null {
  if (typeof message !== "object" || message === null) return null;
  const m = message as Record<string, unknown>;
  switch (m.type) {
    case "ready":
      return { type: "ready" };
    case "request": {
      const target = parseTarget(m.target);
      return target === null ? null : { type: "request", target };
    }
    case "edit": {
      const { id, project, file, revision, start, end, text } = m;
      if (
        !isCount(id) ||
        typeof project !== "string" ||
        typeof file !== "string" ||
        !isCount(revision) ||
        !isCount(start) ||
        !isCount(end) ||
        typeof text !== "string"
      ) {
        return null;
      }
      return { type: "edit", id, project, file, revision, start, end, text };
    }
    default:
      return null;
  }
}

/** Whether `module` is a dotted module path, with no segment that could act as a path of its own. */
export function isModulePath(module: string): boolean {
  return module.split(".").every((segment) => segment !== "" && !/[/\\]/.test(segment));
}

/** A file as the webview holds it: the document it is, its text, and the revision it came with. */
export interface Held<U> {
  uri: U;
  text: string;
  revision: number;
}

/** The key of a held file: two projects may both have `src/main.gcl`. */
export function heldKey(project: string, file: string): string {
  return JSON.stringify([project, file]);
}

/** An edit to apply, giving the text the webview holds afterwards; or why it may not be applied. */
export type EditCheck =
  | { ok: true; next: string }
  /** `resync`: the webview's copy is behind the document and needs the current text. */
  | { ok: false; message: string; resync: boolean };

/**
 * Whether an edit the webview made on its copy of a file fits the document,
 * whose text is now `current`. The offsets are on the copy of `revision`:
 * they fit only while that copy is the latest the extension sent and the
 * document has not changed since.
 */
export function checkEdit<U>(
  held: Held<U>,
  edit: Pick<EditMessage, "file" | "revision" | "start" | "end" | "text">,
  current: string,
): EditCheck {
  if (edit.revision !== held.revision) {
    // A newer copy is on its way to the webview.
    return { ok: false, message: `${edit.file} was reloaded; edit again`, resync: false };
  }
  if (current !== held.text) {
    return {
      ok: false,
      message: `${edit.file} changed since the view read it; edit again`,
      resync: true,
    };
  }
  if (edit.start > edit.end || edit.end > held.text.length) {
    return { ok: false, message: `the edit is outside ${edit.file}`, resync: false };
  }
  return {
    ok: true,
    next: held.text.slice(0, edit.start) + edit.text + held.text.slice(edit.end),
  };
}
