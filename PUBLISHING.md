# Publishing the VS Code Extension

1. Install dependencies and build the extension:

   ```sh
   npm install
   npm run compile
   ```

   The extension is bundled with esbuild. Runtime dependencies such as
   `vscode-languageclient` are included in `out/extension.js`; `node_modules`
   is intentionally not shipped in the VSIX.

2. Make sure the `publisher` field in `package.json` matches the Visual Studio Marketplace publisher account.

3. Check the versioning constraint for VS Code Marketplace pre-releases.

   > [!NOTE]
   > The VS Code Marketplace only accepts extension versions in `major.minor.patch` format, even for pre-releases.
   > SemVer pre-release tags such as `0.0.1-alpha.8` are not supported.
   >
   > Mark a build as pre-release by passing `--pre-release` to `vsce`, not by adding a pre-release suffix to `package.json`.
   > VS Code recommends using odd minor versions for pre-releases and even minor versions for regular releases.
   > For example, use `0.1.0` for a pre-release and `0.2.x` for the corresponding regular release line.

4. Create a Visual Studio Marketplace personal access token (PAT), then expose it as `VSCE_PAT`:

   ```sh
   export VSCE_PAT="<token>"
   ```

5. Verify that the PAT can publish for the configured publisher:

   ```sh
   npx vsce verify-pat Graphcal
   ```

6. Package the VSIX as a pre-release:

   ```sh
   npm run package -- --pre-release
   ```

   This runs `vscode:prepublish`, which typechecks and creates a production
   esbuild bundle, then invokes `vsce package --no-dependencies`.

7. Inspect the packaged contents before publishing:

   ```sh
   npx vsce ls --no-dependencies
   ```

   The VSIX should include `out/extension.js` and should not include
   `node_modules` or `src`.

8. Publish the packaged VSIX as a pre-release:

   ```sh
   npx vsce publish --no-dependencies --pre-release --packagePath graphcal-0.1.0.vsix
   ```

   Alternatively, publish directly from the working tree as a pre-release:

   ```sh
   npx vsce publish --no-dependencies --pre-release
   ```
