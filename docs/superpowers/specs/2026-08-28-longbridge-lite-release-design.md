# Longbridge Lite cross-platform release design

## Goal

Publish installable Longbridge Lite builds for macOS, Linux, and Windows from GitHub Releases. The application must run independently of the source checkout, appear in each platform's application launcher, and support user-level installation without administrator privileges.

## Product identity

- Rename the Cargo package and executable from `gpui-shell-longbridge` to `longbridge-lite`.
- Use `Longbridge Lite` as the display name.
- Use `longbridge-lite` for commands, directories, release assets, desktop identifiers, and environment-variable prefixes.
- Preserve the existing plugin identifier unless changing it is required for runtime correctness; it identifies persisted application state rather than the executable filename.
- Store the official icon from `https://assets.lbkrs.com/uploads/2e476c46-8bb9-4689-a800-54877351520e/app-icon.svg` in the repository. Release builds never fetch branding assets at build time.

## Runtime resource discovery

The executable must not depend on its build machine's `CARGO_MANIFEST_DIR`. It resolves the script application directory in this order:

1. `LONGBRIDGE_LITE_APP_DIR`, for tests and development overrides.
2. A packaged resource directory relative to the executable.
3. The source checkout's `app/` directory as a development-only fallback.

Packaged layouts are explicit and covered by contract tests:

- macOS: `Longbridge Lite.app/Contents/MacOS/longbridge-lite` and `Contents/Resources/app`.
- Linux: `longbridge-lite.app/bin/longbridge-lite` and `longbridge-lite.app/share/app`.
- Windows: `longbridge-lite/bin/longbridge-lite.exe` and `longbridge-lite/app`.

## GitHub Release workflow

`.github/workflows/release.yml` runs for `v*` tags and can also be invoked manually. It builds release binaries on native GitHub-hosted runners:

- macOS arm64
- macOS x86_64
- Linux x86_64 GNU
- Windows x86_64 MSVC

Each build creates a complete portable package, including the script application and platform metadata. A final release job downloads the build artifacts, produces `SHA256SUMS`, and creates or updates the tag's GitHub Release using the repository's `GITHUB_TOKEN`. The workflow uses GitHub-maintained actions and the runner-provided `gh` CLI; it does not introduce a third-party release action.

Release assets are:

- `longbridge-lite-macos-aarch64.tar.gz`
- `longbridge-lite-macos-x86_64.tar.gz`
- `longbridge-lite-linux-x86_64.tar.gz`
- `longbridge-lite-windows-x86_64.zip`
- `SHA256SUMS`
- `install.sh`
- `install.ps1`

The workflow fails if the tag version does not match `Cargo.toml` after removing the leading `v`.

## Platform packages

### macOS

Build a standard unsigned `Longbridge Lite.app` containing `Info.plist`, the executable, `app/`, and a generated ICNS icon. The archive preserves the `.app` hierarchy. Signing, notarization, and DMG creation are out of scope until credentials are available.

### Linux

Build a relocatable `longbridge-lite.app` directory modeled on the Longbridge Desktop installer:

- `bin/longbridge-lite`
- `share/app`
- `share/applications/longbridge-lite.desktop`
- `share/icons/hicolor/512x512/apps/longbridge-lite.png`

The desktop entry uses display name `Longbridge Lite`, categories `Finance;Office;`, an absolute executable path installed by the script, and the packaged icon. The package targets the glibc baseline of the selected Ubuntu runner; the installer reports a clear error for musl and older glibc systems.

### Windows

Build a zip containing `bin/longbridge-lite.exe`, `app/`, and the ICO icon. The executable embeds the icon where practical using a Windows resource file; the package retains the ICO for shortcut creation.

## Installers

### POSIX installer

`install.sh` is POSIX `sh` and supports macOS and Linux. It accepts `--version`, `--uninstall`, and a local bundle override for offline/CI tests. Without a version it resolves the latest non-prerelease GitHub Release, selects an asset from `uname`, downloads it to a private temporary directory, verifies it against `SHA256SUMS`, and replaces the existing installation only after verification and extraction succeed.

- macOS installs to `~/Applications/Longbridge Lite.app` and links the command into `~/.local/bin/longbridge-lite`.
- Linux installs to `~/.local/longbridge-lite.app`, links the command into `~/.local/bin/longbridge-lite`, copies and rewrites the packaged desktop entry into `~/.local/share/applications`, and runs `update-desktop-database` when available.
- Uninstall removes installed application files, command links, and launcher metadata but preserves user data.
- If `~/.local/bin` is absent from `PATH`, the script prints shell-specific instructions instead of silently editing shell startup files.

### Windows installer

`install.ps1` supports an explicit version, uninstall, and a local bundle override. It resolves the latest non-prerelease GitHub Release, downloads the x86_64 zip and checksums, verifies SHA-256, and atomically installs under `%LOCALAPPDATA%\longbridge-lite`. It creates a Start Menu shortcut using the packaged icon and adds the binary directory to the user PATH only when absent. Uninstall removes application files, shortcut, and its own PATH entry while preserving user data.

## Safety and update behavior

- Downloads use HTTPS and fail closed on HTTP or checksum errors.
- Archives are extracted into a temporary staging directory before replacing an installation.
- Installer cleanup traps remove temporary files.
- Re-running an installer upgrades in place.
- Unsupported OS/architecture combinations fail with the list of published targets.
- Installers never invoke `sudo` or require elevated PowerShell.

## Verification

- Existing Rust and application tests remain green after the package rename.
- Add tests for resource-directory precedence and packaged layouts.
- Validate `release.yml` as YAML and inspect action references and permissions.
- Run `sh -n install.sh` and static behavioral tests using local fake bundles and temporary HOME directories.
- Parse `install.ps1` on a Windows runner and exercise local-bundle install/uninstall there.
- Release jobs smoke-test each packaged executable's resource discovery without starting an unbounded authenticated session.
