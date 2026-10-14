# Verify that the Marketplace PAT can publish for Graphcal.
verify-pat:
    op run --env-file=.env -- vp exec vsce verify-pat Graphcal

# Build a pre-release VSIX.
package: check-view-bundle
    vpr package --pre-release

# List the files that would be included in the VSIX.
inspect:
    vp exec vsce ls --no-dependencies

# Publish an inspected pre-release VSIX.
publish vsix:
    @unzip -l "{{ vsix }}" | grep -q 'extension/media/view/view.js' && unzip -l "{{ vsix }}" | grep -q 'extension/media/view/view.css' || { echo "{{ vsix }} has no view bundle: run 'just view-bundle', then 'just package'" >&2; exit 1; }
    op run --env-file=.env -- vp exec vsce publish --no-dependencies --pre-release --packagePath "{{ vsix }}"

# Publish a pre-release directly from the working tree.
publish-direct: check-view-bundle
    op run --env-file=.env -- vp exec vsce publish --no-dependencies --pre-release

# Build the view webview bundle from ../graphcal/web/view into media/view, with its graphcal commit in SOURCE.
view-bundle:
    cd ../graphcal/web/view && VIEW_OUT=../../../vscode-graphcal/media/view node_modules/.bin/vp build --config vite.webview.config.ts
    git -C ../graphcal diff --quiet HEAD -- web/view && dirty="" || dirty=" with uncommitted changes"; echo "graphcal $(git -C ../graphcal rev-parse HEAD)$dirty" > media/view/SOURCE

# Fail unless media/view holds the view bundle: a VSIX without it opens an empty view.
check-view-bundle:
    @test -f media/view/view.js -a -f media/view/view.css || { echo "media/view has no view bundle: run 'just view-bundle' first" >&2; exit 1; }
    @echo "view bundle: $(cat media/view/SOURCE 2>/dev/null || echo 'built from an unrecorded graphcal commit')"
