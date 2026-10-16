import { describe, expect, test } from "vite-plus/test";
import { serverPath } from "../src/serverPath";

const folders = [
  { name: "graphcal", fsPath: "/src/graphcal" },
  { name: "docs", fsPath: "/src/docs" },
];

describe("serverPath", () => {
  test.each([
    ["", "graphcal"],
    ["/usr/local/bin/graphcal", "/usr/local/bin/graphcal"],
    ["./target/debug/graphcal", "./target/debug/graphcal"],
    ["${workspaceFolder}/target/debug/graphcal", "/src/graphcal/target/debug/graphcal"],
    ["${workspaceFolder:docs}/bin/graphcal", "/src/docs/bin/graphcal"],
    ["${workspaceFolder:graphcal}/${workspaceFolder}", "/src/graphcal//src/graphcal"],
  ])("expands %j", (configured, command) => {
    expect(serverPath(configured, folders)).toEqual({ ok: true, command });
  });

  test.each([
    ["${workspaceFolder}/graphcal", []],
    ["${workspaceFolder:missing}/graphcal", folders],
    ["${userHome}/graphcal", folders],
    ["${env:HOME}/graphcal", folders],
    ["${}/graphcal", folders],
  ])("refuses %j", (configured, open) => {
    expect(serverPath(configured, open)).toMatchObject({ ok: false });
  });

  test("names every unresolved variable", () => {
    const result = serverPath("${workspaceFolder:a}/${workspaceFolder:b}", folders);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.error).toContain("${workspaceFolder:a}");
      expect(result.error).toContain("${workspaceFolder:b}");
    }
  });
});
