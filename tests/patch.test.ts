import { describe, expect, test } from "vite-plus/test";
import { applyEdits, locateHunks, parsePatch } from "../src/patch";

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

describe("parsePatch", () => {
  test("reads files and hunks, skipping the heading and the no-newline note", () => {
    const files = parsePatch(patch);
    expect(files.map((f) => f.path)).toEqual([
      "power_project/src/power_project/power_max.gcl",
      "f",
    ]);
    expect(files[0]?.hunks).toEqual([
      {
        oldStart: 1,
        oldLines: ["param a = 1.0;", "param b = 2.0;", "node c = @a + @b;", "node d = @c;"],
        newLines: ["param a = 1.0;", "param b = 3.0;", "node c = @a + @b;", "node d = @c;"],
      },
    ]);
    expect(files[1]?.hunks[0]?.newLines).toEqual(["a", "x", "y", "b"]);
    expect(parsePatch("nothing here")).toEqual([]);
  });
});

describe("locateHunks", () => {
  test("applies a hunk where it says, and finds it again when lines moved", () => {
    const [file] = parsePatch(patch);
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
    const [file] = parsePatch(patch);
    if (!file) throw new Error("no patch");
    const changed = "param a = 1.0;\nparam b = 2.5;\nnode c = @a + @b;\nnode d = @c;\n";
    expect(locateHunks(changed, file)).toEqual({ edits: [], failed: 1 });
  });

  test("keeps a file without a final newline as it is", () => {
    const file = parsePatch(patch)[1];
    if (!file) throw new Error("no patch");
    expect(applyEdits("a\nb", locateHunks("a\nb", file).edits)).toBe("a\nx\ny\nb");
  });
});
