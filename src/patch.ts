// A unified diff, as the Graphcal web view copies its what-if edits (and as
// `git diff` prints), parsed and located in a file's text. Pure functions:
// the command in applyChanges.ts turns the located hunks into workspace edits.

export interface Hunk {
  /** 1-based line in the old text where the hunk says it starts. */
  oldStart: number;
  /** The old side of the hunk: context and removed lines. */
  oldLines: string[];
  /** The new side: context and added lines. */
  newLines: string[];
}

export interface FilePatch {
  /** The path after `b/`. */
  path: string;
  hunks: Hunk[];
}

const HUNK_HEAD = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** The files of a patch, or why the text is not a patch that can be applied as it is. */
export type ParsedPatch = { ok: true; files: FilePatch[] } | { ok: false; error: string };

/**
 * Every file's hunks in a unified diff; text before the first `diff --git` or
 * `---` is ignored. A hunk holds exactly the lines its header counts: one cut
 * short (a copy that lost its end) or overrunning is an error, never a
 * partial edit.
 */
export function parsePatch(text: string): ParsedPatch {
  const lines = text.split(/\r?\n/);
  // The newline ending the last line does not start another one.
  if (lines[lines.length - 1] === "") lines.pop();
  const files: FilePatch[] = [];
  let current: FilePatch | null = null;
  let hunk: Hunk | null = null;
  /** The 1-based line of the open hunk's header, for errors. */
  let headLine = 0;
  /** How many old and new lines the open hunk still needs. */
  let missing = { old: 0, new: 0 };
  for (const [index, line] of lines.entries()) {
    if (hunk !== null) {
      // Inside a hunk its header's counts decide what a line is: removing a
      // line `-- x` reads `--- x`, which is not the next file's header.
      if (line.startsWith("\\")) continue; // "\ No newline at end of file"
      const mark = line === "" ? " " : line[0];
      const body = line.slice(1);
      if (mark === " " && missing.old > 0 && missing.new > 0) {
        hunk.oldLines.push(body);
        hunk.newLines.push(body);
        missing = { old: missing.old - 1, new: missing.new - 1 };
      } else if (mark === "-" && missing.old > 0) {
        hunk.oldLines.push(body);
        missing = { ...missing, old: missing.old - 1 };
      } else if (mark === "+" && missing.new > 0) {
        hunk.newLines.push(body);
        missing = { ...missing, new: missing.new - 1 };
      } else {
        return {
          ok: false,
          error: `line ${index + 1} does not fit the hunk that line ${headLine} announces`,
        };
      }
      if (missing.old === 0 && missing.new === 0) hunk = null;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      current = null;
      continue;
    }
    if (line.startsWith("--- ")) {
      current = { path: "", hunks: [] };
      files.push(current);
      continue;
    }
    const head = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
    if (head && current !== null && current.path === "" && current.hunks.length === 0) {
      current.path = head[1] ?? "";
      continue;
    }
    const at = HUNK_HEAD.exec(line);
    if (at) {
      if (current === null || current.path === "") {
        return { ok: false, error: `the hunk at line ${index + 1} has no file header before it` };
      }
      hunk = { oldStart: Number(at[1]), oldLines: [], newLines: [] };
      current.hunks.push(hunk);
      headLine = index + 1;
      missing = { old: Number(at[2] ?? "1"), new: Number(at[4] ?? "1") };
      if (missing.old === 0 && missing.new === 0) hunk = null;
    }
    // Anything else between hunks (a heading, `index …`) is not the patch's.
  }
  if (hunk !== null) {
    return { ok: false, error: `the hunk at line ${headLine} is cut off` };
  }
  return { ok: true, files: files.filter((f) => f.path !== "" && f.hunks.length > 0) };
}

/** A replacement of lines `[start, end)` (0-based) of the original text. */
export interface LineEdit {
  start: number;
  end: number;
  lines: string[];
}

/** Where `hunk`'s old side matches in `lines`, nearest to where it says it is; -1 when nowhere. */
function locate(lines: readonly string[], hunk: Hunk, from: number): number {
  const matches = (at: number): boolean => {
    if (at < 0 || at + hunk.oldLines.length > lines.length) return false;
    for (let k = 0; k < hunk.oldLines.length; k += 1) {
      if (lines[at + k] !== hunk.oldLines[k]) return false;
    }
    return true;
  };
  const want = hunk.oldStart - 1;
  for (let distance = 0; distance <= lines.length; distance += 1) {
    const below = want + distance;
    const above = want - distance;
    if (below >= from && matches(below)) return below;
    if (distance > 0 && above >= from && matches(above)) return above;
    if (above < from && below > lines.length) break;
  }
  return -1;
}

/**
 * The edits that apply `patch` to `text`, each on the original line numbers,
 * and how many hunks found no place. Hunks are matched in order, each after
 * the previous one, exactly on their old side (context included), nearest to
 * the line the hunk names.
 */
export function locateHunks(text: string, patch: FilePatch): { edits: LineEdit[]; failed: number } {
  const lines = text.split("\n");
  const edits: LineEdit[] = [];
  let failed = 0;
  let from = 0;
  for (const hunk of patch.hunks) {
    const at = locate(lines, hunk, from);
    if (at < 0) {
      failed += 1;
      continue;
    }
    edits.push({ start: at, end: at + hunk.oldLines.length, lines: [...hunk.newLines] });
    from = at + hunk.oldLines.length;
  }
  return { edits, failed };
}

/** `text` with the edits applied (for tests and non-editor uses). */
export function applyEdits(text: string, edits: readonly LineEdit[]): string {
  const lines = text.split("\n");
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    lines.splice(edit.start, edit.end - edit.start, ...edit.lines);
  }
  return lines.join("\n");
}
