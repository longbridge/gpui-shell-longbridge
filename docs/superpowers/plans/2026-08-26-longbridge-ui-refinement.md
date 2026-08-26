# Longbridge UI Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a native, responsive, animated, read-only Longbridge Watchlist and Portfolio that remains usable with the real account’s 55-item Watchlist.

**Architecture:** Add one generic stateful vertical-scroll behavior to the gpui-shell JavaScript bridge, reusing native GPUI/gpui-component scroll ownership and the shell’s existing motion APIs. Keep product layout and state presentation in the Longbridge JavaScript application, split pure presentation helpers from orchestration, and verify behavior through shell tests, QuickJS application vectors, and a real window.

**Tech Stack:** Rust, GPUI, gpui-base/gpui-component, gpui-shell QuickJS bridge, JavaScript, Longbridge OpenAPI HTTP/WebSocket.

**Spec:** `docs/superpowers/specs/2026-08-26-longbridge-ui-refinement-design.md`

## Global Constraints

- Watchlist remains read-only and account-derived; no add/remove/edit or trading actions.
- Preserve `longbridge-terminal` ordering and selection by symbol.
- Only the row region scrolls; headers and status remain fixed.
- Use existing `transition`/`spring` motion and gpui-base reduced-motion policy.
- Preserve all unrelated dirty changes in `../gpui-component`; do not commit either dirty checkout automatically.
- Use stable domain IDs, theme tokens, visible keyboard focus, and region-owned overflow.

---

### Task 1: Native vertical scrolling in gpui-shell

**Files:**
- Modify: `../gpui-component/crates/shell/src/spec.rs`
- Modify: `../gpui-component/crates/shell/src/engine/quickjs/mod.rs`
- Modify: `../gpui-component/crates/shell/src/materialize.rs`
- Modify: `../gpui-component/crates/shell/src/typings.rs`
- Test: `../gpui-component/crates/shell/src/tests/render.rs`

**Interfaces:**
- Produces: `Element.scroll_y(): Element`, a stable-ID stateful native vertical scroll owner with a trailing scrollbar.
- Consumes: existing SpecOp/behavior materialization and gpui-component `Scrollable` implementation.

- [ ] Add a failing QuickJS render test whose element calls `.id("quotes").scroll_y()` and whose oversized children can be materialized without an unknown-method error.
- [ ] Run the targeted shell test and confirm it fails because `scroll_y` is unknown.
- [ ] Add `scroll_y` to the bridge’s behavior method list and generated `Element` declarations.
- [ ] Materialize the behavior with the native scrollable wrapper/handle keyed by element identity; reject or warn when stable identity is missing according to existing behavior conventions.
- [ ] Add a debug-tree or interaction assertion proving the behavior is retained and not silently treated as style.
- [ ] Run shell formatting, targeted tests, and Clippy without changing unrelated dirty files.

### Task 2: Authenticated application render regression

**Files:**
- Create: `app/workspace_ui.test.js`
- Modify: `tests/app_vectors.rs`
- Modify: `app/main.js`

**Interfaces:**
- Consumes: `Element.scroll_y()` from Task 1.
- Produces: a test seam that renders loaded/reconnecting/empty workspace states with representative data and no network calls.

- [ ] Write a failing runtime vector that instantiates the authenticated Watchlist with at least 55 rows and asserts the loaded workspace renders rather than the shell error view.
- [ ] Run the vector and confirm it reproduces the current `unknown element method overflow_y_scroll` failure.
- [ ] Replace the unsupported call with `.id("watchlist-quotes").scroll_y()` and add the same ownership to holdings.
- [ ] Run the vector and existing application suite until green.

### Task 3: Design Guides layout and state refinement

**Files:**
- Modify: `app/main.js`
- Modify: `app/ui.js`
- Modify: `app/market.js`
- Modify: `app/types.d.ts`
- Modify: `app/watchlist_ui.test.js`
- Modify: `app/market.test.js`

**Interfaces:**
- Produces: compact shell/header, master–detail Watchlist, scroll-owned quote collection, aligned detail description, compact Portfolio, and explicit loading/empty/reconnecting/partial states.
- Consumes: account Watchlist instruments, quote freshness/session state, current selection symbol, theme semantic tokens.

- [ ] Extend UI vectors with expected hierarchy/copy for loaded, loading, empty, reconnecting, and partial-coverage states; verify the new assertions fail.
- [ ] Replace repeated uppercase chrome and nested card treatment with a flat header/tab/status structure and sentence-case copy.
- [ ] Give master and detail panes content-based minimum widths, `min_w_0`/`min_h_0`, and a narrow-window fallback that preserves the list’s usable columns.
- [ ] Tighten row density, align numeric lanes, preserve stable row IDs, and distinguish selected/hover/focus/waiting/stale states using text plus semantic styling.
- [ ] Refactor detail metrics into aligned description rows and keep selected symbol stable across dynamic sorting.
- [ ] Add skeleton/empty/error/status presentation that keeps previous quotes visible during reconnect.
- [ ] Run market and UI vectors after each coherent state change.

### Task 4: Restrained motion and final verification

**Files:**
- Modify: `app/main.js`
- Modify: `app/ui.js`
- Modify: `app/watchlist_ui.test.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: existing `Element.transition(property, policy)` / `spring(property, policy)` with stable element IDs.
- Produces: selection/detail/status/price-update motion that is nonessential to comprehension and reduced-motion aware.

- [ ] Add failing UI-vector assertions for stable IDs and motion declarations on selection detail, connection state, and changed quote values.
- [ ] Apply 140–180 ms ease-out opacity transitions to selected detail and connection/status surfaces; use no full-pane layout animation.
- [ ] Add a brief price-cell emphasis keyed by symbol and quote sequence/receipt revision without continuous flashing.
- [ ] Verify motion does not change row geometry or replace textual state.
- [ ] Update README with scroll, responsive layout, state, and motion behavior.
- [ ] Run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and the full test suites in both repositories.
- [ ] Launch the real application and verify scrolling, selection, reconnect feedback, light/dark themes, and narrow/default sizes without using an overridden screenshot directory.
