import { beforeEach, expect, test, vi } from "vite-plus/test";
import { reset, state, vscode } from "./vscodeMock";

vi.mock("vscode", async () => (await import("./vscodeMock")).vscode);

const { GraphcalView } = await import("../src/view");

const A = "file:///work/a/src/main.gcl";
const B = "file:///work/b/src/main.gcl";

/** The server: answers the uris in `answerAtOnce`, and holds every other answer for the test to give. */
const server = {
  requests: [] as string[],
  held: new Map<string, ((model: unknown) => void)[]>(),
  answerAtOnce: new Map<string, unknown>(),
};

beforeEach(() => {
  reset();
  server.requests = [];
  server.held.clear();
  server.answerAtOnce.clear();
  state.files.set("/ext/media/view/view.js", "");
  for (const project of ["a", "b"]) {
    state.files.set(`/work/${project}/graphcal.toml`, "");
    state.files.set(`/work/${project}/src/main.gcl`, "param n = 1;\n");
  }
});

function model(project: string, tag?: string) {
  const nodes = tag === undefined ? [] : [{ source: null, tag }];
  return { module: { id: `${project}.main`, file: "src/main.gcl", package: project }, nodes };
}

function editor(uri: string) {
  return { document: { uri: vscode.Uri.parse(uri), languageId: "graphcal" } };
}

function view() {
  let announce: (params: { uri: string }) => void = () => {};
  const v = new GraphcalView({ extensionUri: vscode.Uri.file("/ext"), subscriptions: [] } as never);
  v.attach({
    onNotification: (_: string, handler: (params: { uri: string }) => void) => {
      announce = handler;
      return { dispose() {} };
    },
    sendRequest: (_: string, params: { textDocument: { uri: string } }) => {
      const uri = params.textDocument.uri;
      server.requests.push(uri);
      if (server.answerAtOnce.has(uri)) return Promise.resolve(server.answerAtOnce.get(uri));
      return new Promise((resolve) =>
        server.held.set(uri, [...(server.held.get(uri) ?? []), resolve]),
      );
    },
  } as never);
  return { view: v, announce: (uri: string) => announce({ uri }) };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 1));
}

function receive(message: unknown): void {
  if (!state.receive) throw new Error("no panel");
  state.receive(message);
}

async function openOn(uri: string) {
  const v = view();
  state.active = editor(uri);
  await v.view.open();
  receive({ type: "ready" });
  await settle();
  return v;
}

function posted(type: string) {
  return state.posted.filter((m) => m.type === type) as { [key: string]: any }[];
}

function editOn(sent: { [key: string]: any }, id: number, change: object) {
  return {
    type: "edit",
    id,
    project: sent.project,
    file: "src/main.gcl",
    revision: sent.revision,
    ...change,
  };
}

test("an older main answer arriving last does not replace the newer file's sheet", async () => {
  const v = await openOn(A);
  v.view.follow(editor(B) as never);
  server.held.get(B)?.[0]?.(model("b"));
  await settle();
  server.held.get(A)?.[0]?.(model("a"));
  await settle();
  expect(posted("model").map((m) => m.model.module.id)).toEqual(["b.main"]);
});

test("of two answers for the same sheet, the older one arriving last is dropped", async () => {
  const v = await openOn(A);
  v.announce(A);
  await settle();
  const [older, newer] = server.held.get(A) ?? [];
  newer?.(model("a", "newer"));
  await settle();
  older?.(model("a", "older"));
  await settle();
  expect(posted("model").map((m) => m.model.nodes[0]?.tag)).toEqual(["newer"]);
});

test("an edit made on A's sheet goes to A's file while B loads, never to B's", async () => {
  server.answerAtOnce.set(A, model("a"));
  const v = await openOn(A);
  const [sent] = posted("model");
  expect(sent).toMatchObject({ project: "file:///work/a", main: true });
  v.view.follow(editor(B) as never); // B's model never comes
  await settle();
  receive(editOn(sent!, 1, { start: 10, end: 11, text: "2" }));
  await settle();
  expect(state.files.get("/work/a/src/main.gcl")).toBe("param n = 2;\n");
  expect(state.files.get("/work/b/src/main.gcl")).toBe("param n = 1;\n");
  expect(posted("edited")).toEqual([{ type: "edited", id: 1, ok: true }]);
});

test("offsets on a copy the editor has changed since are refused, and the copy is resent", async () => {
  server.answerAtOnce.set(A, model("a"));
  await openOn(A);
  const [sent] = posted("model");
  state.files.set("/work/a/src/main.gcl", "// local\nparam n = 1;\n");
  receive(editOn(sent!, 7, { start: 10, end: 11, text: "2" }));
  await settle();
  expect(state.files.get("/work/a/src/main.gcl")).toBe("// local\nparam n = 1;\n");
  expect(posted("edited")).toMatchObject([{ id: 7, ok: false }]);
  const resent = posted("model").at(-1);
  expect(resent?.revision).toBeGreaterThan(sent!.revision);
  expect(resent?.sources["src/main.gcl"]).toBe("// local\nparam n = 1;\n");
});

test("an edit on a copy older than the latest sent is refused", async () => {
  server.answerAtOnce.set(A, model("a"));
  const v = await openOn(A);
  const [first] = posted("model");
  v.announce(A);
  await settle();
  expect(posted("model")).toHaveLength(2);
  receive(editOn(first!, 2, { start: 10, end: 11, text: "2" }));
  await settle();
  expect(state.files.get("/work/a/src/main.gcl")).toBe("param n = 1;\n");
  expect(posted("edited")).toMatchObject([{ id: 2, ok: false }]);
});

test("two edits in a row land in order even when the first is slower", async () => {
  server.answerAtOnce.set(A, model("a"));
  await openOn(A);
  const [sent] = posted("model");
  state.openDelays = [30, 0];
  receive(editOn(sent!, 1, { start: 10, end: 11, text: "2" }));
  // The second edit is on the webview's copy after the first: "param n = 2;\n".
  receive(editOn(sent!, 2, { start: 12, end: 12, text: " // two" }));
  await new Promise((resolve) => setTimeout(resolve, 60));
  await settle();
  expect(state.files.get("/work/a/src/main.gcl")).toBe("param n = 2; // two\n");
  expect(posted("edited")).toEqual([
    { type: "edited", id: 1, ok: true },
    { type: "edited", id: 2, ok: true },
  ]);
});

test("an edit for a project whose copy the view does not hold is refused", async () => {
  server.answerAtOnce.set(A, model("a"));
  await openOn(A);
  const [sent] = posted("model");
  receive({ ...editOn(sent!, 3, { start: 10, end: 11, text: "2" }), project: "file:///work/b" });
  await settle();
  expect(state.files.get("/work/b/src/main.gcl")).toBe("param n = 1;\n");
  expect(posted("edited")).toMatchObject([{ id: 3, ok: false }]);
});

test("a malformed edit is answered, so the view does not wait forever", async () => {
  server.answerAtOnce.set(A, model("a"));
  await openOn(A);
  receive({ type: "edit", id: 9, file: "src/main.gcl" });
  await settle();
  expect(posted("edited")).toMatchObject([{ id: 9, ok: false }]);
});

test("an untitled Graphcal document never becomes the main sheet", async () => {
  server.answerAtOnce.set(A, model("a"));
  const v = await openOn(A);
  v.view.follow(editor("untitled:Untitled-1") as never);
  await settle();
  expect(server.requests.every((uri) => uri.startsWith("file://"))).toBe(true);
});

test("opened without a .gcl file, the view says so instead of loading forever", async () => {
  await view().view.open();
  receive({ type: "ready" });
  await settle();
  expect(state.posted).toEqual([{ type: "note", message: "open a .gcl file to show it here" }]);
});

test("without the view bundle, Open View says so and opens no panel", async () => {
  state.files.delete("/ext/media/view/view.js");
  state.active = editor(A);
  await view().view.open();
  expect(state.receive).toBeNull();
  expect(state.posted).toMatchObject([{ type: "error" }]);
});

test("with no active .gcl editor, Open View shows a visible one", async () => {
  server.answerAtOnce.set(B, model("b"));
  state.visible = [editor("untitled:Untitled-1"), editor(B)];
  await view().view.open();
  receive({ type: "ready" });
  await settle();
  expect(server.requests).toEqual([B]);
});

test("Open View brings an open panel to the front where it is", async () => {
  const v = await openOn(A);
  await v.view.open();
  expect(state.reveals).toEqual([undefined]);
});
