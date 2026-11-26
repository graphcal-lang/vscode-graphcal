# Publishing the VS Code Extension

1. Install dependencies and build the extension:

   ```sh
   vp install
   vpr compile
   ```

   The extension is bundled with Vite+ Pack (tsdown and Rolldown). Runtime
   dependencies such as `vscode-languageclient` are included in
   `out/extension.js`; `node_modules` is intentionally not shipped in the VSIX.

   Then build the Graphcal view's webview bundle from a `graphcal` checkout
   next to this repository (`../graphcal`, with the `web/view` dependencies
   installed):

   ```sh
   just view-bundle
   ```

   It writes `media/view/`, which Git does not track, and records the
   `graphcal` commit it was built from in `media/view/SOURCE`. `just package`
   and `just publish-direct` refuse to run without it, and `just publish`
   refuses a VSIX without it.

2. Make sure the `publisher` field in `package.json` matches the Visual Studio Marketplace publisher account.

3. Check the versioning constraint for VS Code Marketplace pre-releases.

   > [!NOTE]
   > The VS Code Marketplace only accepts extension versions in `major.minor.patch` format, even for pre-releases.
   > SemVer pre-release tags such as `0.0.1-alpha.8` are not supported.
   >
   > Mark a build as pre-release by passing `--pre-release` to `vsce`, not by adding a pre-release suffix to `package.json`.
   > VS Code recommends using odd minor versions for pre-releases and even minor versions for regular releases.
   > For example, use `0.1.0` for a pre-release and `0.2.x` for the corresponding regular release line.

4. Sign in to the 1Password CLI:

   ```sh
   op signin
   ```

   The PAT is stored in the dedicated `Graphcal` vault. The committed `.env`
   contains only its 1Password secret reference; publishing recipes pass that
   file to `op run`, which injects the PAT only into the child process.

5. Verify that the PAT can publish for the configured publisher:

   ```sh
   just verify-pat
   ```

   If it fails with "The Personal Access Token used has expired", create a new
   PAT as described in [Renewing the PAT](#renewing-the-pat).

6. Package the VSIX as a pre-release:

   ```sh
   just package
   ```

   This runs `vscode:prepublish`, which formats, lints, typechecks, and creates
   a minified production bundle with Vite+ Pack, then invokes
   `vsce package --no-dependencies`.

7. Inspect the packaged contents before publishing:

   ```sh
   just inspect
   ```

   The VSIX should include `out/extension.js` and `media/view/` and should not include
   `node_modules` or `src`.

8. Publish the packaged VSIX as a pre-release:

   ```sh
   just publish graphcal-0.3.0.vsix
   ```

   Alternatively, publish directly from the working tree as a pre-release:

   ```sh
   just publish-direct
   ```

## Renewing the PAT

> [!WARNING]
> Azure DevOps retires global PATs on December 1, 2026, and the Marketplace
> accepts only global PATs. After that date this procedure no longer works,
> and publishing has to move to
> [Trusted Publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace)
> from GitHub Actions.

Give the PAT the least access that still lets `vsce` publish:

1. Sign in to <https://dev.azure.com> with the account that owns the
   `Graphcal` Marketplace publisher.

2. Open **User settings** (next to the profile image), then
   **Personal access tokens**, then **New Token**.

3. Fill in the form:
   - **Name**: something that says what it is for, such as
     `vsce publish Graphcal`.
   - **Organization**: **All accessible organizations**. The Marketplace is
     not part of any organization, so a token for a single organization fails
     with 401 or 403.
   - **Expiration**: **Custom defined**, set to the last day you plan to
     publish with it. A short lifetime limits the damage if it leaks.
   - **Scopes**: **Custom defined**. Select **Show all scopes**, then select
     only **Marketplace → Manage**. This is the scope the VS Code
     documentation requires for `vsce publish`. Leave every other scope
     unselected.

4. Select **Create** and copy the token. Azure DevOps shows it only once.

5. Paste it into the existing PAT item in the `Graphcal` 1Password vault,
   replacing the old value. `.env` stays unchanged because it refers to the
   item, not to the token.

6. Check the new token:

   ```sh
   just verify-pat
   ```

7. After publishing, revoke the token in **Personal access tokens** unless you
   will publish again before it expires.
