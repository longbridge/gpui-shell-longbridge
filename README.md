# gpui-shell Longbridge

A standalone, read-only Longbridge OpenAPI desktop example built on the public
`gpui-shell` API. It uses OAuth 2 device authorization, direct HTTP requests,
and the Longbridge WebSocket protocol. It does not use the Longbridge CLI or an
SDK, and it contains no order placement, amendment, or cancellation surface.

The JavaScript application lives in `app/`; the small Rust binary is only its
native GPUI host. During local development, `gpui-shell` is a path dependency on
`../gpui-component/crates/shell`.

## Run

Register this OAuth public client once, then set the fixed `CLIENT_ID` in
`app/auth.js`. A public client must not contain a client secret.

```sh
cargo run
```

On first launch, choose **Sign in**, open the Longbridge authorization link in
your browser, and approve the device. The session is stored under the plugin's
bundle ID. Logged-out users see only the sign-in gate.

The signed-in workspace has two views:

- **Watchlist** — the account's Longbridge watchlist groups flattened into a
  deduplicated, selectable, scrollable quote list with a detail view. Sorting
  matches `longbridge-terminal`: regular-session securities first, then
  US → HK → SH/SZ → SG, while equal keys preserve API order.
- **Portfolio** — a read-only account overview and stock holdings table.

There are no controls for adding or removing symbols, and no chart, trade tape,
bid/ask book, or trading command.

## Verify

```sh
cargo test
```

The Rust test suite loads the application's JavaScript through the same
QuickJS/GPUI runtime used by the desktop host, including protocol, stream,
market-state, and rendered Watchlist vectors.

Running the application refreshes `app/gpui.d.ts` from the exact runtime API.
The generated file is ignored so it cannot become stale in source control.
