import { describe, expect, test } from "vite-plus/test";
import { type PathContext, serverPath } from "../src/serverPath";

const context: PathContext = {
  folders: [
    { name: "graphcal", fsPath: "/src/graphcal" },
    { name: "docs", fsPath: "/src/docs" },
  ],
  userHome: "/home/me",
  env: { GRAPHCAL_HOME: "/opt/graphcal", EMPTY: "" },
  pathSeparator: "/",
};

describe("serverPath", () => {
  test.each([
    ["", "graphcal"],
    ["/usr/local/bin/graphcal", "/usr/local/bin/graphcal"],
    ["./target/debug/graphcal", "./target/debug/graphcal"],
    ["${workspaceFolder}/target/debug/graphcal", "/src/graphcal/target/debug/graphcal"],
    ["${workspaceFolder:docs}/bin/graphcal", "/src/docs/bin/graphcal"],
    ["${workspaceFolder:graphcal}/${workspaceFolder}", "/src/graphcal//src/graphcal"],
    ["${userHome}/.cargo/bin/graphcal", "/home/me/.cargo/bin/graphcal"],
    ["${env:GRAPHCAL_HOME}/bin/graphcal", "/opt/graphcal/bin/graphcal"],
    ["${userHome}${pathSeparator}bin${/}graphcal", "/home/me/bin/graphcal"],
  ])("expands %j", (configured, command) => {
    expect(serverPath(configured, context)).toEqual({ ok: true, command });
  });

  test("uses the given path separator", () => {
    const windows = { ...context, userHome: "C:\\Users\\me", pathSeparator: "\\" };
    expect(serverPath("${userHome}${/}graphcal.exe", windows)).toEqual({
      ok: true,
      command: "C:\\Users\\me\\graphcal.exe",
    });
  });

  test("refuses ${workspaceFolder} with no folder open", () => {
    expect(serverPath("${workspaceFolder}/graphcal", { ...context, folders: [] })).toMatchObject({
      ok: false,
    });
  });

  test.each([
    "${workspaceFolder:missing}/graphcal",
    "${workspaceFolder:}/graphcal",
    "${env:UNSET}/graphcal",
    "${env:EMPTY}/graphcal",
    "${env:}/graphcal",
    "${config:graphcal.lsp.path}",
    "${file}",
    "${}/graphcal",
  ])("refuses %j", (configured) => {
    expect(serverPath(configured, context)).toMatchObject({ ok: false });
  });

  test("names every unresolved variable", () => {
    const result = serverPath("${workspaceFolder:a}/${env:UNSET}", context);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.error).toContain("${workspaceFolder:a}");
      expect(result.error).toContain("${env:UNSET}");
    }
  });
});
