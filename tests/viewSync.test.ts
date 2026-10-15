import { describe, expect, test } from "vite-plus/test";
import { checkEdit, heldKey, isModulePath, parseFromView } from "../src/viewSync";

const edit = {
  type: "edit",
  id: 1,
  project: "file:///work/a",
  file: "src/a/main.gcl",
  revision: 3,
  start: 10,
  end: 11,
  text: "2",
};

describe("parseFromView", () => {
  test("reads the messages the webview sends", () => {
    expect(parseFromView({ type: "ready" })).toEqual({ type: "ready" });
    expect(parseFromView({ type: "request", module: "a.b" })).toEqual({
      type: "request",
      module: "a.b",
    });
    expect(parseFromView(edit)).toEqual(edit);
  });

  test.each([
    ["no object", "edit"],
    ["an unknown type", { type: "nope" }],
    ["an edit without its revision", { ...edit, revision: undefined }],
    ["an edit without its project", { ...edit, project: undefined }],
    ["a negative offset", { ...edit, start: -1 }],
    ["a fractional offset", { ...edit, end: 1.5 }],
    ["text that is no string", { ...edit, text: 2 }],
    ["a request without a module", { type: "request" }],
  ])("refuses %s", (_, message) => {
    expect(parseFromView(message)).toBeNull();
  });
});

describe("isModulePath", () => {
  test.each([
    ["power_project", true],
    ["power_project.eps", true],
    ["a..b", false],
    [".a", false],
    ["a.", false],
    ["a/../../b", false],
    ["a\\b", false],
    ["", false],
  ])("%j is a module path: %s", (module, expected) => {
    expect(isModulePath(module)).toBe(expected);
  });
});

describe("heldKey", () => {
  test("tells the same file of two projects apart", () => {
    expect(heldKey("file:///work/a", "src/main.gcl")).not.toBe(
      heldKey("file:///work/b", "src/main.gcl"),
    );
  });
});

describe("checkEdit", () => {
  const text = "param n = 1;\n";
  const held = { uri: "a", text, revision: 3 };

  test("applies an edit made on the latest copy of an unchanged document", () => {
    expect(checkEdit(held, edit, text)).toEqual({ ok: true, next: "param n = 2;\n" });
  });

  test("refuses offsets on a copy the editor has changed since, and asks to resync", () => {
    // The editor inserted a line above: offset 10 is now inside `// local`.
    expect(checkEdit(held, edit, `// local\n${text}`)).toMatchObject({ ok: false, resync: true });
  });

  test("refuses an edit on an older copy without resync: the newer one is on its way", () => {
    expect(checkEdit({ ...held, revision: 4 }, edit, text)).toMatchObject({
      ok: false,
      resync: false,
    });
  });

  test.each([
    ["beyond the end", { ...edit, start: 13, end: 14 }],
    ["backwards", { ...edit, start: 5, end: 4 }],
  ])("refuses a span %s", (_, span) => {
    expect(checkEdit(held, span, text)).toMatchObject({ ok: false });
  });

  test("inserts at the end of the copy", () => {
    expect(checkEdit(held, { ...edit, start: 13, end: 13, text: "x" }, text)).toEqual({
      ok: true,
      next: `${text}x`,
    });
  });
});
