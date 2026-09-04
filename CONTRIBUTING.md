# Contributing

The Rust host here is deliberately small: it selects the application root,
configures assets, creates a `ShellRuntime`, and opens a window. Product state
and rendering live in JavaScript under `app/`. README's *Architecture* section
describes where each boundary sits; read it before moving logic across one.

## Getting set up

You need a Rust toolchain and, for the JavaScript tests that run outside the
host, [Bun](https://bun.sh). Everything else is fetched by Cargo.

Register an OAuth public client once and set its fixed `CLIENT_ID` in
`app/auth.js`. A public client must not contain a client secret.

## Running

```sh
cargo run
```

Debug builds reload changes under `app/` into the existing window, and refresh
the ignored `app/gpui-kit.d.ts` declaration file from the API the runtime
actually exposes.

Two environment variables help when something feels slow:

- `LONGBRIDGE_PROFILE=1` prints, once a second, GPUI's own `Window::draw` cost
  (`frame-profile`) and the runtime's share of it (`shell-profile`). Read
  `mean_draw` first: it is what a frame costs, and it decides whether scrolling
  and dragging stay smooth.
- `MTL_HUD_ENABLED=1` turns on Metal's own overlay on macOS, beside the
  application's.

A low FPS number is usually not a problem. GPUI draws only when something
changed, so an idle window presents rarely by design; `FRAME`, `P95` and `DROP`
are what say whether the frames it did draw were affordable.

## Verifying

There is no CI workflow for tests — only releases are automated — so run them
before pushing:

```sh
cargo test --locked
cargo build --locked --release
```

The tests execute application modules through the same QuickJS runtime the
desktop host uses. The keyboard-only acceptance probes live in
`tests/app_vectors.rs` and dispatch real keystrokes through a GPUI window; run
them alone with `cargo test --test app_vectors --locked`.

## Commits and pull requests

Commit subjects are `scope: Capitalised summary` — `trade: Add order placement`,
`ui: Draw square corners` — with the scope left off when a change has no natural
one. Write what changed and why it changed in the body; the repository's history
is the design record, so a subject alone is rarely enough.

## Releasing

A release is a commit that moves the version, and a tag on it.

1. `scripts/set-version.sh X.Y.Z`. It writes the version into `Cargo.toml`,
   `app/gpui-shell.json` and `Cargo.lock` — the three files that have to agree,
   and the whole change. It leaves `shell-version` alone, refuses a leading
   `v`, and prints the commands for the next two steps.
2. Commit it as `Version vX.Y.Z`.
3. Tag that commit `vX.Y.Z` and push the tag. `.github/workflows/release.yml`
   triggers on `v*` and builds the platform packages. It also accepts a
   `workflow_dispatch` with an existing tag, for re-running a publish.

`scripts/release-fast-path.sh` decides whether the release can reuse the
previous version's native host instead of building one. It can when nothing
changed under `src`, `Cargo.toml`, `Cargo.lock`, `app/assets/fonts`,
`packaging`, `assets` or `scripts/package-release.*`, and when
`shell-version` is unchanged — that is, when the release is application code
only. Touching the host means a full build, which is slower but not something
you need to arrange.

`shell-version` in `app/gpui-shell.json` is a different number from the
application version: it declares which `gpui-shell` runtime the application
expects. It has to match the runtime the host is built against, or the manifest
is rejected at load with `IncompatibleShellVersion`.

## Upstream dependencies

Two projects this one is built on are developed alongside it:

- **[gpui-kit](https://github.com/longbridge/gpui-kit)** — the GPUI facade,
  `gpui-base`, and the `gpui-shell` runtime that executes `app/`. Pinned by
  `Cargo.lock`; `cargo update -p gpui-kit -p gpui-shell` moves it.
- **[omarchy-ui](https://github.com/huacnlee/omarchy-ui)** — the component
  library, fetched as a Git dependency named in `app/gpui-shell.json`.

A behavior that looks wrong here is often theirs, and worth fixing there rather
than working around. Their CI builds with `-D warnings`, so run
`cargo clippy --all-targets -- -D warnings` on a change to gpui-kit before
pushing it — `cargo test` alone will not catch a stray doc comment.

Omarchy's surfaces are square. Do not add `.rounded(...)`: an element with no
corner call is what the desktop draws, and the `radius` tokens are all zero.
