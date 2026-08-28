#!/bin/sh
set -eu

from=${1:?usage: scripts/release-fast-path.sh <previous-ref> <release-ref>}
to=${2:?usage: scripts/release-fast-path.sh <previous-ref> <release-ref>}

git rev-parse --verify "$from^{commit}" >/dev/null
git rev-parse --verify "$to^{commit}" >/dev/null

# These paths either affect the native executable or the structure of a
# platform package. Application files outside the bundled fonts are loaded at
# runtime and can be replaced without rebuilding the host.
if ! git diff --quiet "$from" "$to" -- \
    src Cargo.toml Cargo.lock app/assets/fonts packaging assets \
    scripts/package-release.sh scripts/package-release.ps1; then
  exit 1
fi

manifest_value() {
  sed -n 's/^[[:space:]]*"shell-version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

old_shell_version=$(git show "$from:app/gpui-shell.json" | manifest_value)
new_shell_version=$(git show "$to:app/gpui-shell.json" | manifest_value)
[ -n "$old_shell_version" ] && [ "$old_shell_version" = "$new_shell_version" ]
