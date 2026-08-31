# Verify that the Marketplace PAT can publish for Graphcal.
verify-pat:
    op run --env-file=.env -- vp exec vsce verify-pat Graphcal

# Build a pre-release VSIX.
package:
    vpr package --pre-release

# List the files that would be included in the VSIX.
inspect:
    vp exec vsce ls --no-dependencies

# Publish an inspected pre-release VSIX.
publish vsix:
    op run --env-file=.env -- vp exec vsce publish --no-dependencies --pre-release --packagePath "{{ vsix }}"

# Publish a pre-release directly from the working tree.
publish-direct:
    op run --env-file=.env -- vp exec vsce publish --no-dependencies --pre-release
