import { describe, expect, test } from "vite-plus/test";
import { pathSegments, uniqueMatch } from "../src/patchPath";

describe("pathSegments", () => {
  test.each([
    ["f", ["f"]],
    [
      "power_project/src/power_project/power_max.gcl",
      ["power_project", "src", "power_project", "power_max.gcl"],
    ],
    ["a/..b/c.d", ["a", "..b", "c.d"]],
  ])("splits %s", (path, segments) => {
    expect(pathSegments(path)).toEqual({ ok: true, segments });
  });

  test.each([
    "../outside.gcl",
    "src/../../outside.gcl",
    "src/..",
    "./f",
    "/etc/passwd",
    "/dev/null",
    "C:/Windows/f",
    "c:f",
    "src\\..\\f",
    "a//b",
    "a/",
    "",
  ])("refuses %j", (path) => {
    expect(pathSegments(path)).toMatchObject({ ok: false });
  });
});

describe("uniqueMatch", () => {
  test.each([
    [[], { kind: "missing" }],
    [["a"], { kind: "found", value: "a" }],
    [["a", "b"], { kind: "ambiguous" }],
  ])("chooses among %j", (candidates, match) => {
    expect(uniqueMatch(candidates)).toEqual(match);
  });
});
