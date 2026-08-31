#!/bin/sh
set -eu

target="${1:?usage: scripts/package-release.sh <macos-aarch64|linux-x86_64> [binary]}"
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$repo_root/app/gpui-shell.json" | head -n 1)
binary=${2:-"$repo_root/target/release/longbridge-lite"}
dist="$repo_root/dist"

case "$target" in
  macos-aarch64 | linux-x86_64) ;;
  *) printf 'unsupported release target: %s\n' "$target" >&2; exit 2 ;;
esac
[ -n "$version" ] || { printf 'app/gpui-shell.json has no version\n' >&2; exit 1; }

mkdir -p "$dist"
stage=$(mktemp -d "$dist/.package-$target-XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM

reuse_archive=${LONGBRIDGE_LITE_REUSE_ARCHIVE:-}
if [ -n "$reuse_archive" ]; then
  [ -f "$reuse_archive" ] || { printf 'reuse archive is missing: %s\n' "$reuse_archive" >&2; exit 1; }
  tar -xzf "$reuse_archive" -C "$stage"

  if [ "${target#macos-}" != "$target" ]; then
    app="$stage/Longbridge Lite.app"
    [ -x "$app/Contents/MacOS/longbridge-lite" ] || { printf 'reuse archive has no macOS host\n' >&2; exit 1; }
    rm -rf "$app/Contents/Resources/app"
    mkdir -p "$app/Contents/Resources/app"
    cp -R "$repo_root/app/." "$app/Contents/Resources/app/"
    sed "s/__VERSION__/$version/g" "$repo_root/packaging/macos/Info.plist" > "$app/Contents/Info.plist"
    archive="$dist/longbridge-lite-$target.tar.gz"
    tar -czf "$archive" -C "$stage" "Longbridge Lite.app"
  else
    app="$stage/longbridge-lite.app"
    [ -x "$app/bin/longbridge-lite" ] || { printf 'reuse archive has no Linux host\n' >&2; exit 1; }
    rm -rf "$app/share/app"
    mkdir -p "$app/share/app"
    cp -R "$repo_root/app/." "$app/share/app/"
    archive="$dist/longbridge-lite-linux-x86_64.tar.gz"
    tar -czf "$archive" -C "$stage" longbridge-lite.app
  fi

  printf '%s\n' "$archive"
  exit 0
fi

[ -x "$binary" ] || { printf 'release binary is missing: %s\n' "$binary" >&2; exit 1; }

if [ "${target#macos-}" != "$target" ]; then
  # The macOS icon carries its own squircle mask and padding, so it must be
  # rendered from the 1024pt bundle artwork rather than the square base icon.
  icon_svg="$repo_root/assets/app-icon-macos.svg"
  if command -v rsvg-convert >/dev/null 2>&1; then
    render_icon() { rsvg-convert -w "$1" -h "$1" "$icon_svg" -o "$2"; }
  elif command -v magick >/dev/null 2>&1; then
    render_icon() { magick -background none -density 512 "$icon_svg" -resize "$1x$1" "$2"; }
  else
    printf 'rsvg-convert or ImageMagick is required\n' >&2
    exit 1
  fi
  app="$stage/Longbridge Lite.app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/app"
  cp "$binary" "$app/Contents/MacOS/longbridge-lite"
  strip "$app/Contents/MacOS/longbridge-lite"
  cp -R "$repo_root/app/." "$app/Contents/Resources/app/"
  sed "s/__VERSION__/$version/g" "$repo_root/packaging/macos/Info.plist" > "$app/Contents/Info.plist"

  iconset="$stage/longbridge-lite.iconset"
  mkdir -p "$iconset"
  for size in 16 32 128 256 512; do
    render_icon "$size" "$iconset/icon_${size}x${size}.png"
    render_icon "$((size * 2))" "$iconset/icon_${size}x${size}@2x.png"
  done
  # A renderer without SVG support writes an empty or mis-sized file instead of
  # failing, which would ship a broken icon.
  for png in "$iconset"/*.png; do
    [ -s "$png" ] || { printf 'failed to render %s\n' "$png" >&2; exit 1; }
  done
  iconutil -c icns "$iconset" -o "$app/Contents/Resources/longbridge-lite.icns"
  chmod 755 "$app/Contents/MacOS/longbridge-lite"
  archive="$dist/longbridge-lite-$target.tar.gz"
  tar -czf "$archive" -C "$stage" "Longbridge Lite.app"
else
  app="$stage/longbridge-lite.app"
  mkdir -p "$app/bin" "$app/share/app" "$app/share/applications" \
    "$app/share/icons/hicolor/512x512/apps"
  cp "$binary" "$app/bin/longbridge-lite"
  strip "$app/bin/longbridge-lite"
  cp -R "$repo_root/app/." "$app/share/app/"
  cp "$repo_root/packaging/linux/longbridge-lite.desktop" \
    "$app/share/applications/longbridge-lite.desktop"
  if command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert -w 512 -h 512 "$repo_root/assets/app-icon.svg" \
      -o "$app/share/icons/hicolor/512x512/apps/longbridge-lite.png"
  elif command -v magick >/dev/null 2>&1; then
    magick -background none "$repo_root/assets/app-icon.svg" -resize 512x512 \
      "$app/share/icons/hicolor/512x512/apps/longbridge-lite.png"
  else
    printf 'rsvg-convert or ImageMagick is required\n' >&2
    exit 1
  fi
  chmod 755 "$app/bin/longbridge-lite"
  archive="$dist/longbridge-lite-linux-x86_64.tar.gz"
  tar -czf "$archive" -C "$stage" longbridge-lite.app
fi

printf '%s\n' "$archive"
