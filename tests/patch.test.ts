import { describe, expect, test } from "vite-plus/test";
import { applyEdits, locateHunks, parsePatch, type FilePatch } from "../src/patch";

const patch = [
  "# graphcal what-if: o/r @ main",
  "",
  "diff --git a/power_project/src/power_project/power_max.gcl b/power_project/src/power_project/power_max.gcl",
  "--- a/power_project/src/power_project/power_max.gcl",
  "+++ b/power_project/src/power_project/power_max.gcl",
  "@@ -1,4 +1,4 @@",
  " param a = 1.0;",
  "-param b = 2.0;",
  "+param b = 3.0;",
  " node c = @a + @b;",
  " node d = @c;",
  "diff --git a/f b/f",
  "--- a/f",
  "+++ b/f",
  "@@ -1,2 +1,4 @@",
  " a",
  "+x",
  "+y",
  " b",
  "\\ No newline at end of file",
  "",
].join("\n");

/** The files of a patch the test expects to parse. */
function files(text: string): FilePatch[] {
  const parsed = parsePatch(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.files;
}

describe("parsePatch", () => {
  test("reads files and hunks, skipping the heading and the no-newline note", () => {
    const parsed = files(patch);
    expect(parsed.map((f) => f.path)).toEqual([
      "power_project/src/power_project/power_max.gcl",
      "f",
    ]);
    expect(parsed[0]?.hunks).toEqual([
      {
        oldStart: 1,
        oldLines: ["param a = 1.0;", "param b = 2.0;", "node c = @a + @b;", "node d = @c;"],
        newLines: ["param a = 1.0;", "param b = 3.0;", "node c = @a + @b;", "node d = @c;"],
      },
    ]);
    expect(parsed[1]?.hunks[0]?.newLines).toEqual(["a", "x", "y", "b"]);
    expect(parsePatch("nothing here")).toEqual({ ok: true, files: [] });
  });

  test.each([
    ["without a final newline", "--- a/f\n+++ b/f\n@@ -1 +1 @@\n-param n = 1;"],
    ["with a final newline", "--- a/f\n+++ b/f\n@@ -1 +1 @@\n-param n = 1;\n"],
    ["before the next file", "--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n-b\n--- a/g\n+++ b/g\n"],
  ])("refuses a hunk cut off %s instead of deleting its lines", (_, text) => {
    expect(parsePatch(text)).toMatchObject({ ok: false });
  });

  test.each([
    ["an extra removed line", "--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n-b\n+c\n"],
    ["a line of no kind", "--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n?b\n"],
    ["a hunk without a file", "@@ -1 +1 @@\n-a\n+b\n"],
  ])("refuses %s", (_, text) => {
    expect(parsePatch(text)).toMatchObject({ ok: false });
  });

  test("reads a removed `-- x` line as the hunk's, not as the next file's header", () => {
    const text = "--- a/f\n+++ b/f\n@@ -1,3 +1,2 @@\n a\n--- x\n b\n@@ -10 +9 @@\n-c\n+d\n";
    expect(files(text)).toEqual([
      {
        path: "f",
        hunks: [
          { oldStart: 1, oldLines: ["a", "-- x", "b"], newLines: ["a", "b"] },
          { oldStart: 10, oldLines: ["c"], newLines: ["d"] },
        ],
      },
    ]);
  });

  test("reads an empty context line whose space was trimmed", () => {
    expect(files("--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n\n-b\n+c\n")[0]?.hunks).toEqual([
      { oldStart: 1, oldLines: ["a", "", "b"], newLines: ["a", "", "c"] },
    ]);
  });
});

describe("locateHunks", () => {
  test("applies a hunk where it says, and finds it again when lines moved", () => {
    const [file] = files(patch);
    if (!file) throw new Error("no patch");
    const text = "param a = 1.0;\nparam b = 2.0;\nnode c = @a + @b;\nnode d = @c;\n";
    const exact = locateHunks(text, file);
    expect(exact.failed).toBe(0);
    expect(applyEdits(text, exact.edits)).toBe(
      "param a = 1.0;\nparam b = 3.0;\nnode c = @a + @b;\nnode d = @c;\n",
    );
    const moved = `// a comment\n// another\n${text}`;
    const found = locateHunks(moved, file);
    expect(found.edits[0]?.start).toBe(2);
    expect(applyEdits(moved, found.edits)).toBe(
      "// a comment\n// another\nparam a = 1.0;\nparam b = 3.0;\nnode c = @a + @b;\nnode d = @c;\n",
    );
  });

  test("reports a hunk whose context is gone instead of guessing", () => {
    const [file] = files(patch);
    if (!file) throw new Error("no patch");
    const changed = "param a = 1.0;\nparam b = 2.5;\nnode c = @a + @b;\nnode d = @c;\n";
    expect(locateHunks(changed, file)).toEqual({ edits: [], failed: 1 });
  });

  test("keeps a file without a final newline as it is", () => {
    const file = files(patch)[1];
    if (!file) throw new Error("no patch");
    expect(applyEdits("a\nb", locateHunks("a\nb", file).edits)).toBe("a\nx\ny\nb");
  });
});
