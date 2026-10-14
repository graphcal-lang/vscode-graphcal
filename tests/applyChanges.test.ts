import { beforeEach, expect, test, vi } from "vite-plus/test";
import { reset, state } from "./vscodeMock";

vi.mock("vscode", async () => (await import("./vscodeMock")).vscode);

const { applyChangesFromClipboard } = await import("../src/applyChanges");

/** A one-file patch replacing `param n = 1;` by `param n = 2;`. */
function patch(path: string): string {
  return `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-param n = 1;\n+param n = 2;\n`;
}

beforeEach(() => {
  reset();
});

test("applies a patch to the file it names under the workspace folder", async () => {
  state.folders = ["/work/project"];
  state.files.set("/work/project/src/main.gcl", "param n = 1;\n");
  state.clipboard = patch("src/main.gcl");
  await applyChangesFromClipboard();
  expect(state.files.get("/work/project/src/main.gcl")).toBe("param n = 2;\n");
});

test("refuses a patch whose path climbs out of the workspace", async () => {
  state.folders = ["/work/project"];
  state.files.set("/work/outside.gcl", "param n = 1;\n");
  state.clipboard = patch("../outside.gcl");
  await applyChangesFromClipboard();
  expect(state.files.get("/work/outside.gcl")).toBe("param n = 1;\n");
  expect(state.posted).toMatchObject([{ type: "error" }]);
});

test("changes nothing when one file of the patch may not be edited", async () => {
  state.folders = ["/work/project"];
  state.files.set("/work/project/src/main.gcl", "param n = 1;\n");
  state.clipboard = patch("src/main.gcl") + patch("/etc/main.gcl");
  await applyChangesFromClipboard();
  expect(state.files.get("/work/project/src/main.gcl")).toBe("param n = 1;\n");
});

test("does not choose between workspace folders that both have the file", async () => {
  state.folders = ["/work/a", "/work/b"];
  state.files.set("/work/a/src/main.gcl", "param n = 1;\n");
  state.files.set("/work/b/src/main.gcl", "param n = 1;\n");
  state.clipboard = patch("src/main.gcl");
  await applyChangesFromClipboard();
  expect(state.files.get("/work/a/src/main.gcl")).toBe("param n = 1;\n");
  expect(state.files.get("/work/b/src/main.gcl")).toBe("param n = 1;\n");
});

test("refuses a patch cut off before its new lines instead of deleting the old ones", async () => {
  state.folders = ["/work/project"];
  state.files.set("/work/project/src/main.gcl", "param n = 1;\n");
  state.clipboard = "--- a/src/main.gcl\n+++ b/src/main.gcl\n@@ -1 +1 @@\n-param n = 1;";
  await applyChangesFromClipboard();
  expect(state.files.get("/work/project/src/main.gcl")).toBe("param n = 1;\n");
  expect(state.posted).toMatchObject([{ type: "error" }]);
});
