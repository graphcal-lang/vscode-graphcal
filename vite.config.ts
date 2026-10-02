import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  pack: {
    entry: { extension: "src/extension.ts" },
    outDir: "out",
    format: ["cjs"],
    platform: "node",
    target: "node20",
    outputOptions: { entryFileNames: "[name].js" },
    deps: {
      resolveDepSubpath: true,
      alwaysBundle: [/^vscode-languageclient(?:\/|$)/],
      neverBundle: ["vscode"],
      onlyBundle: false,
    },
  },
});
