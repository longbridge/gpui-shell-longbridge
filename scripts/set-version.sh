#!/bin/sh
set -eu

# The application version lives in three files that have to agree: the crate's
# manifest, the shell manifest the runtime reads, and the lockfile that records
# what the crate resolved to. Setting them by hand means one of them is
# eventually forgotten, and a release ships a package whose name and manifest
# disagree.
#
# `shell-version` is deliberately not touched. It names the gpui-shell runtime
# this application expects, which moves with the dependency rather than with
# the release.

version="${1:?usage: scripts/set-version.sh <version>}"
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

case "$version" in
  v*)
    printf 'pass the version without the leading v: %s\n' "${version#v}" >&2
    exit 2
    ;;
esac

if ! printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
  printf 'not a version: %s\n' "$version" >&2
  exit 2
fi

cargo_toml="$repo_root/Cargo.toml"
manifest="$repo_root/app/gpui-shell.json"

# Anchored at the start of a line, so a dependency's inline `version = "..."`
# is left alone -- only the `[package]` one begins a line.
current=$(sed -n 's/^version = "\([^"]*\)".*/\1/p' "$cargo_toml" | head -n 1)
[ -n "$current" ] || { printf 'Cargo.toml has no package version\n' >&2; exit 1; }

if [ "$current" = "$version" ]; then
  printf 'already at %s\n' "$version"
  exit 0
fi

replace() {
  file=$1
  script=$2
  tmp="$file.set-version.$$"
  # Written through a temporary file rather than `sed -i`, whose spelling
  # differs between BSD and GNU and so between a laptop and CI.
  sed "$script" "$file" > "$tmp" && mv "$tmp" "$file"
}

replace "$cargo_toml" "1,/^\[/ s/^version = \"[^\"]*\"/version = \"$version\"/"
replace "$manifest" "s/^\([[:space:]]*\)\"version\": \"[^\"]*\"/\1\"version\": \"$version\"/"

# Cargo rewrites the lockfile's own record of this package. `--offline` keeps
# it from reaching the network to do it.
( cd "$repo_root" && cargo metadata --format-version 1 --offline >/dev/null 2>&1 ) ||
  ( cd "$repo_root" && cargo metadata --format-version 1 >/dev/null )

for file in Cargo.toml app/gpui-shell.json Cargo.lock; do
  case $(cd "$repo_root" && git diff --name-only -- "$file") in
    "") printf 'warning: %s did not change\n' "$file" >&2 ;;
  esac
done

printf '%s -> %s\n\n' "$current" "$version"
printf 'next:\n'
printf '  git commit -am "Version v%s"\n' "$version"
printf '  git tag v%s\n' "$version"
printf '  git push && git push origin v%s\n' "$version"
