# gpui-shell Longbridge

An architecture example showing how a JavaScript application can run as a
native GPUI desktop program through `gpui-shell`. Longbridge market data is the
real-world integration used to exercise the runtime; the repository is
primarily a demonstration of host/application boundaries, not a full trading
terminal.

- [Longbridge OpenAPI](https://open.longbridge.com/)
- [gpui-component](https://github.com/longbridge/gpui-component)

## Architecture

```text
Rust host (`src/main.rs`)
├── initializes GPUI and gpui-shell
├── installs application palettes and filesystem assets
├── grants the plugin's capability policy
└── mounts the JavaScript view into a native GPUI window
                         │
                         ▼
gpui-shell runtime (`../gpui-component/crates/shell`)
├── executes ES modules in QuickJS
├── records declarative element descriptions
├── materializes descriptions as native GPUI elements
├── owns native events, timers, storage, HTTP and WebSocket bridges
└── rebuilds the application snapshot during development hot reload
                         │
                         ▼
JavaScript application (`app/`)
├── OAuth and token lifecycle
├── Longbridge HTTP and WebSocket protocols
├── read-only market and portfolio state
└── theme-aware native UI composition
                         │
                         ▼
Longbridge OpenAPI
├── OAuth 2 device authorization and authenticated HTTP APIs
└── binary protobuf quote stream over WebSocket
```

### Host boundary

The Rust executable is deliberately small. It selects the application root,
configures assets, creates `ShellRuntime`, loads the
plugin, and opens `ShellRoot`. Native concerns stay in the host; product state
and rendering stay in JavaScript.

The host depends on `gpui-shell` from
`../gpui-component/crates/shell`. `gpui-shell` builds on GPUI and the lower-level
primitives in `gpui-base`, then exposes a constrained ES-module API — one module
per crate that provides the capability, so `"gpui"` holds GPUI's own elements and
what the runtime adds, `"gpui-base"` holds base's layout helpers, components and
theme, and `"gpui-fps"` holds its performance overlay. The application never
imports Rust implementation details.

### Render boundary

JavaScript `View.render()` does not directly retain native elements. It records
an immutable element description in QuickJS. Rust materializes that snapshot
into GPUI elements and can repaint it without re-entering the VM. State-changing
callbacks update the JavaScript view and explicitly notify the host to build a
new snapshot.

Theme values cross the same boundary as semantic tokens. Icon SVGs use the
theme-tinted mask path, while brand artwork uses the full-color image path.
Scrollbars and other behavior primitives read the palette projected into
`gpui_base`.

### Data boundary

The application talks directly to [Longbridge OpenAPI](https://open.longbridge.com/):

1. OAuth device authorization obtains and durably stores rotating tokens.
2. Authenticated HTTP loads Watchlist, account, and holdings snapshots.
3. A WebSocket session authenticates with an OTP, subscribes to quote pushes,
   and requests the initial quote snapshot.
4. Partial protobuf pushes are folded onto the snapshot using sequence and
   timestamp ordering.
5. Market groups are ordered by session (`Trading`, then `Pre`, then other),
   followed by `US → HK → CN → SG`. Items inside each market retain their
   original Watchlist API order.

The plugin manifest grants only the required Longbridge network origins. No
process execution or trading mutation API is exposed to the JavaScript layer.

### Application modules

| Path | Responsibility |
| --- | --- |
| `src/main.rs` | Native host, palette/assets, plugin mount, debug watcher |
| `app/main.js` | View lifecycle and composition |
| `app/auth.js` | OAuth device flow and token rotation |
| `app/http.js` | Authenticated HTTP boundary |
| `app/protocol.js` | Binary frame and protobuf codecs |
| `app/quote_stream.js` | WebSocket lifecycle, heartbeat, snapshot and reconnect |
| `app/market.js` | Pure Watchlist normalization, quote reduction and ordering |
| `app/ui.js` | Theme-aware presentation components |

Watchlist and Portfolio are intentionally read-only example surfaces. There are
no symbol mutations, chart/order-book features, or order placement APIs.

## Run

Register an OAuth public client once and set its fixed `CLIENT_ID` in
`app/auth.js`. A public client must not contain a client secret.

```sh
cargo run
```

In debug builds, changes under `app/` are reloaded into the existing window.
The runtime also refreshes the ignored `app/gpui.d.ts` declaration file from
the API it actually exposes.

## Verify

```sh
cargo test
```

The tests execute application modules through the same QuickJS runtime used by
the desktop host. They cover protocol codecs, stream lifecycle, market-state
reduction, ordering invariants, capability policy, and native GPUI
materialization.
