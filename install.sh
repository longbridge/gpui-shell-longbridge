#!/bin/sh
set -eu

repository="longbridge/longbridge-lite"
version="latest"
uninstall=0
bundle_path="${LONGBRIDGE_LITE_BUNDLE_PATH:-}"

usage() {
  printf '%s\n' \
    'Usage: install.sh [--version <version>] [--uninstall]' \
    'Environment: LONGBRIDGE_LITE_BUNDLE_PATH installs a local release archive.'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) version="${2:?missing value for --version}"; shift 2 ;;
    --uninstall) uninstall=1; shift ;;
    --help | -h) usage; exit 0 ;;
    *) printf 'unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

os=$(uname -s)
arch=$(uname -m)
case "$os:$arch" in
  Darwin:arm64 | Darwin:aarch64)
    target="macos-aarch64"
    install_dir="$HOME/Applications/Longbridge Lite.app"
    command_path="$install_dir/Contents/MacOS/longbridge-lite"
    ;;
  Linux:x86_64 | Linux:amd64)
    target="linux-x86_64"
    install_dir="$HOME/.local/longbridge-lite.app"
    command_path="$install_dir/bin/longbridge-lite"
    ;;
  *)
    printf 'unsupported platform: %s %s (published: macOS arm64, Linux x86_64)\n' "$os" "$arch" >&2
    exit 1
    ;;
esac

bin_dir="$HOME/.local/bin"
bin_link="$bin_dir/longbridge-lite"
desktop_dir="$HOME/.local/share/applications"
desktop_file="$desktop_dir/longbridge-lite.desktop"

if [ "$uninstall" -eq 1 ]; then
  rm -rf "$install_dir"
  rm -f "$bin_link"
  if [ "$os" = Linux ]; then
    rm -f "$desktop_file"
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$desktop_dir" || true
  fi
  printf 'Longbridge Lite removed; user data was preserved.\n'
  exit 0
fi

if [ "$os" = Linux ] && command -v ldd >/dev/null 2>&1; then
  ldd_line=$(ldd --version 2>&1 | head -n 1 || true)
  case "$ldd_line" in *musl*) printf 'Longbridge Lite requires glibc; musl is not supported.\n' >&2; exit 1 ;; esac
  glibc=$(printf '%s\n' "$ldd_line" | sed -n 's/.* \([0-9][0-9]*\.[0-9][0-9]*\)$/\1/p')
  if [ -n "$glibc" ]; then
    major=${glibc%%.*}; minor=${glibc#*.}
    if [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 35 ]; }; then
      printf 'Longbridge Lite requires glibc >= 2.35; found %s.\n' "$glibc" >&2
      exit 1
    fi
  fi
fi

if command -v curl >/dev/null 2>&1; then
  download() { curl --fail --location --progress-bar "$1" --output "$2"; }
elif command -v wget >/dev/null 2>&1; then
  download() { wget -O "$2" "$1"; }
else
  printf 'curl or wget is required.\n' >&2
  exit 1
fi

temp=$(mktemp -d "${TMPDIR:-/tmp}/longbridge-lite-install-XXXXXX")
trap 'rm -rf "$temp"' EXIT HUP INT TERM
asset="longbridge-lite-$target.tar.gz"

if [ -n "$bundle_path" ]; then
  archive=$bundle_path
else
  tag=$version
  [ "$tag" = latest ] || tag="v${tag#v}"
  if [ "$tag" = latest ]; then
    base="https://github.com/$repository/releases/latest/download"
  else
    base="https://github.com/$repository/releases/download/$tag"
  fi
  archive="$temp/$asset"
  sums="$temp/SHA256SUMS"
  printf 'Downloading %s...\n' "$asset"
  download "$base/$asset" "$archive"
  download "$base/SHA256SUMS" "$sums"
  expected=$(awk -v asset="$asset" '$2 == asset || $2 == "*" asset { print $1; exit }' "$sums")
  [ -n "$expected" ] || { printf 'SHA256SUMS has no entry for %s.\n' "$asset" >&2; exit 1; }
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$archive" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$archive" | awk '{print $1}')
  else
    printf 'sha256sum or shasum is required to verify the release.\n' >&2
    exit 1
  fi
  [ "$actual" = "$expected" ] || { printf 'checksum mismatch for %s.\n' "$asset" >&2; exit 1; }
fi

staging="$temp/extracted"
mkdir -p "$staging"
tar -xzf "$archive" -C "$staging"
if [ "$os" = Darwin ]; then
  source_dir="$staging/Longbridge Lite.app"
else
  source_dir="$staging/longbridge-lite.app"
fi
[ -d "$source_dir" ] || { printf 'release archive has an unexpected layout.\n' >&2; exit 1; }

mkdir -p "$(dirname "$install_dir")" "$bin_dir"
backup="$install_dir.previous"
rm -rf "$backup"
[ ! -e "$install_dir" ] || mv "$install_dir" "$backup"
if mv "$source_dir" "$install_dir"; then
  rm -rf "$backup"
else
  [ ! -e "$backup" ] || mv "$backup" "$install_dir"
  exit 1
fi
ln -sfn "$command_path" "$bin_link"

if [ "$os" = Linux ]; then
  mkdir -p "$desktop_dir"
  icon="$install_dir/share/icons/hicolor/512x512/apps/longbridge-lite.png"
  sed -e "s|^Exec=.*|Exec=$command_path|" -e "s|^Icon=.*|Icon=$icon|" \
    "$install_dir/share/applications/longbridge-lite.desktop" > "$desktop_file"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$desktop_dir" || true
fi

printf 'Longbridge Lite installed at %s\n' "$install_dir"
case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) printf '%s is not on PATH; add it to your shell configuration.\n' "$bin_dir" ;;
esac
