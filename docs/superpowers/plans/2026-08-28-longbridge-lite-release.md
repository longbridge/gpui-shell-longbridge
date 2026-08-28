# Longbridge Lite Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the application to Longbridge Lite and publish self-contained, user-installable macOS, Linux, and Windows builds through GitHub Releases.

**Architecture:** The native host discovers packaged script resources relative to its executable, while release scripts assemble a platform-specific portable layout around the release binary. A tag-driven GitHub Actions matrix builds those layouts, generates checksums, and publishes them; POSIX and PowerShell installers select, verify, and install the matching asset without administrator privileges.

**Tech Stack:** Rust/Cargo, POSIX shell, PowerShell, GitHub Actions YAML, macOS app bundles, freedesktop desktop entries.

**Spec:** `docs/superpowers/specs/2026-08-28-longbridge-lite-release-design.md`

## Global Constraints

- Product, Cargo package, executable, command, directory, and release-asset stem are `longbridge-lite`; display name is `Longbridge Lite`.
- Release builds never fetch the official icon at build time; the source SVG is committed.
- Installers are user-level and never invoke `sudo` or require elevated PowerShell.
- Downloads fail closed on transport and SHA-256 verification errors.
- Preserve existing Longbridge application changes and the plugin identifier unless runtime correctness requires changing it.
- macOS is unsigned and unnotarized in this release implementation.

---

### Task 1: Product identity and relocatable resources

**Files:**
- Modify: `Cargo.toml`
- Modify: `Cargo.lock`
- Modify: `src/main.rs`
- Modify: `tests/application_contract.rs`

**Interfaces:**
- Produces: `fn application_dir() -> PathBuf`, resolving `LONGBRIDGE_LITE_APP_DIR`, packaged paths, then the development path.
- Produces: the `longbridge-lite` Cargo binary used by packaging tasks.

- [ ] **Step 1: Add failing resource and identity contract tests**

Assert that `Cargo.toml` names `longbridge-lite`, `src/main.rs` reads `LONGBRIDGE_LITE_APP_DIR`, and packaged path candidates include macOS `Contents/Resources/app` plus non-macOS sibling layouts without using `CARGO_MANIFEST_DIR` as the first choice.

- [ ] **Step 2: Run the contract test and observe failure**

Run: `cargo test --test application_contract release_build_resolves_packaged_application_resources -- --exact`

- [ ] **Step 3: Implement identity and resource discovery**

Rename the package in `Cargo.toml`. Add `application_dir()` and use it for both `AppAssets` and `PluginManager`; accept only candidate directories containing `gpui-shell.json`, and emit a useful startup error when none exists.

- [ ] **Step 4: Verify task 1**

Run: `cargo test --test application_contract && cargo test --test runtime`

- [ ] **Step 5: Commit task 1**

Commit message: `feat: rename application to longbridge lite`

### Task 2: Brand assets and portable bundle builders

**Files:**
- Create: `assets/app-icon.svg`
- Create: `packaging/linux/longbridge-lite.desktop`
- Create: `packaging/macos/Info.plist`
- Create: `scripts/package-release.sh`
- Create: `scripts/package-release.ps1`
- Create: `tests/release_contract.rs`

**Interfaces:**
- Consumes: release binary named `longbridge-lite` or `longbridge-lite.exe`.
- Produces: `dist/longbridge-lite-<platform>-<arch>.tar.gz` or `.zip` with the layouts named in the spec.

- [ ] **Step 1: Add failing package-layout contract tests**

Check the desktop file's `Name`, `Exec`, `Icon`, `Categories`, and `StartupWMClass`; check `Info.plist` identifiers and executable; check both packaging scripts copy `app/` and the committed icon into their platform layouts.

- [ ] **Step 2: Run and observe failure**

Run: `cargo test --test release_contract package_metadata_names_longbridge_lite -- --exact`

- [ ] **Step 3: Add the official SVG and packaging metadata**

Commit the supplied 128×128 official icon SVG. Add freedesktop and macOS metadata using `longbridge-lite` identifiers.

- [ ] **Step 4: Implement portable package builders**

The POSIX script accepts `macos-aarch64`, `macos-x86_64`, or `linux-x86_64`, stages the exact resource layout, converts the SVG with runner-provided image tools, strips the binary, and creates a reproducibly named tarball. The PowerShell script stages Windows `bin`, `app`, and icon resources and creates the zip.

- [ ] **Step 5: Verify task 2**

Run: `sh -n scripts/package-release.sh` and `cargo test --test release_contract`.

- [ ] **Step 6: Commit task 2**

Commit message: `build: package longbridge lite releases`

### Task 3: User-level installers and launcher integration

**Files:**
- Create: `install.sh`
- Create: `install.ps1`
- Modify: `tests/release_contract.rs`

**Interfaces:**
- Consumes: GitHub release assets and `SHA256SUMS`, or `LONGBRIDGE_LITE_BUNDLE_PATH` for local tests.
- Produces: installed application, command link/PATH entry, Linux desktop entry, macOS app, or Windows Start Menu shortcut.

- [ ] **Step 1: Add failing installer contract tests**

Assert POSIX installer supports `--version`, `--uninstall`, local bundles, SHA-256, Linux desktop installation, `update-desktop-database`, and macOS `~/Applications`. Assert PowerShell supports the same lifecycle, SHA-256, `%LOCALAPPDATA%`, user PATH, and Start Menu shortcut creation.

- [ ] **Step 2: Run and observe failure**

Run: `cargo test --test release_contract installer_contracts_are_complete -- --exact`

- [ ] **Step 3: Implement `install.sh`**

Use GitHub's releases API to resolve the latest stable tag, map `uname` to the published asset, download both asset and checksum file, verify with `sha256sum` or `shasum -a 256`, stage extraction, atomically replace the target, and register/remove platform launchers. Never modify shell startup files.

- [ ] **Step 4: Implement `install.ps1`**

Use GitHub's releases API and `Invoke-WebRequest`, validate with `Get-FileHash`, stage extraction, replace `%LOCALAPPDATA%\longbridge-lite`, create/remove a WScript.Shell `.lnk`, and add/remove only the installer's binary directory in the user PATH.

- [ ] **Step 5: Verify task 3**

Run: `sh -n install.sh` and `cargo test --test release_contract`.

- [ ] **Step 6: Commit task 3**

Commit message: `feat: install longbridge lite releases`

### Task 4: GitHub Release automation

**Files:**
- Create: `.github/workflows/release.yml`
- Modify: `tests/release_contract.rs`

**Interfaces:**
- Consumes: `v*` tag, package scripts, installers, and repository `GITHUB_TOKEN`.
- Produces: four platform archives, installers, `SHA256SUMS`, and a GitHub Release.

- [ ] **Step 1: Add failing workflow contract tests**

Assert tag and manual triggers, `contents: write`, four native matrix entries, release-mode Cargo builds, package-script invocations, artifact upload/download, checksum generation, Cargo/tag version validation, and `gh release` publication.

- [ ] **Step 2: Run and observe failure**

Run: `cargo test --test release_contract workflow_builds_and_publishes_every_target -- --exact`

- [ ] **Step 3: Implement `release.yml`**

Use platform-native jobs and GitHub-maintained checkout/upload/download actions. Install Linux GPUI system dependencies, build `--locked --release`, package each target, aggregate artifacts in a release job, generate `SHA256SUMS`, and publish with `gh release create` or `gh release upload --clobber`.

- [ ] **Step 4: Verify task 4**

Parse the YAML with Ruby's standard YAML parser, run the release contract tests, and inspect all action references and permissions.

- [ ] **Step 5: Commit task 4**

Commit message: `ci: publish longbridge lite releases`

### Task 5: End-to-end verification and documentation

**Files:**
- Modify: `README.md`
- Modify: `tests/release_contract.rs`

**Interfaces:**
- Consumes: all release and installer interfaces from tasks 1–4.
- Produces: documented install/update/uninstall commands and a verified release tree.

- [ ] **Step 1: Document supported targets and commands**

Document `curl -fsSL .../install.sh | sh`, PowerShell `irm .../install.ps1 | iex`, version selection, uninstall, unsigned macOS limitation, Linux glibc target, and manual archive downloads.

- [ ] **Step 2: Run the complete verification suite**

Run: `cargo fmt --all -- --check`, `cargo test --all-targets`, `sh -n install.sh scripts/package-release.sh`, YAML parsing, `git diff --check`, and targeted local-bundle installer tests with temporary directories.

- [ ] **Step 3: Audit repository state**

Confirm no build output, downloaded temporary files, credentials, or unrelated user changes are staged. Confirm every asset referenced by `release.yml` is produced with the exact same name.

- [ ] **Step 4: Commit task 5**

Commit message: `docs: document longbridge lite installation`
