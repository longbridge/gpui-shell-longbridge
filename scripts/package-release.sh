#!/bin/sh
set -eu

target="${1:?usage: scripts/package-release.sh <macos-aarch64|macos-x86_64|linux-x86_64> [binary]}"
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$repo_root/Cargo.toml" | head -n 1)
binary=${2:-"$repo_root/target/release/longbridge-lite"}
dist="$repo_root/dist"

case "$target" in
  macos-aarch64 | macos-x86_64 | linux-x86_64) ;;
  *) printf 'unsupported release target: %s\n' "$target" >&2; exit 2 ;;
esac
[ -x "$binary" ] || { printf 'release binary is missing: %s\n' "$binary" >&2; exit 1; }

mkdir -p "$dist"
stage=$(mktemp -d "$dist/.package-$target-XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM

if [ "${target#macos-}" != "$target" ]; then
  command -v magick >/dev/null 2>&1 || { printf 'ImageMagick (magick) is required\n' >&2; exit 1; }
  app="$stage/Longbridge Lite.app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/app"
  cp "$binary" "$app/Contents/MacOS/longbridge-lite"
  strip "$app/Contents/MacOS/longbridge-lite"
  cp -R "$repo_root/app/." "$app/Contents/Resources/app/"
  sed "s/__VERSION__/$version/g" "$repo_root/packaging/macos/Info.plist" > "$app/Contents/Info.plist"

  iconset="$stage/longbridge-lite.iconset"
  mkdir -p "$iconset"
  for size in 16 32 128 256 512; do
    magick -background none "$repo_root/assets/app-icon.svg" -resize "${size}x${size}" "$iconset/icon_${size}x${size}.png"
    double=$((size * 2))
    magick -background none "$repo_root/assets/app-icon.svg" -resize "${double}x${double}" "$iconset/icon_${size}x${size}@2x.png"
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
