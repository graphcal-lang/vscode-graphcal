// Where a patch's file goes: its path checked before it touches the
// workspace, and the rule for choosing among the files it could name. Pure
// functions: applyChanges.ts looks the candidates up.

/** A patch path split for joining under a workspace folder, or why it may not be. */
export type PathSegments = { ok: true; segments: string[] } | { ok: false; error: string };

/**
 * The segments of a patch path that may name a file under a workspace folder:
 * relative and `/`-separated, without `.`, `..` or empty segments, so that
 * joining it to a folder cannot leave the folder.
 */
export function pathSegments(path: string): PathSegments {
  if (path.includes("\\")) return { ok: false, error: "a backslash in the path" };
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    return { ok: false, error: "an absolute path" };
  }
  const segments = path.split("/");
  if (segments.some((s) => s === "." || s === "..")) {
    return { ok: false, error: "a path that climbs out of its folder" };
  }
  if (segments.some((s) => s === "")) return { ok: false, error: "an empty path segment" };
  return { ok: true, segments };
}

/** The file a patch path names among its candidates. */
export type Match<T> = { kind: "found"; value: T } | { kind: "missing" } | { kind: "ambiguous" };

/** The one candidate; none or several is no choice. */
export function uniqueMatch<T>(candidates: readonly T[]): Match<T> {
  const [first, ...rest] = candidates;
  if (first === undefined) return { kind: "missing" };
  return rest.length === 0 ? { kind: "found", value: first } : { kind: "ambiguous" };
}
