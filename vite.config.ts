import { defineConfig } from "vite-plus";

export default defineConfig({
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
      alwaysBundle: [/^vscode-languageclient(?:\/|$)/],
      neverBundle: ["vscode"],
      onlyBundle: false,
    },
  },
});
