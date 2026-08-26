# Pointer Indicators and Resizable Market Panes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose native pointer and resizable behavior through gpui-shell and use it for the stock chart and market master-detail layout.

**Architecture:** gpui-shell owns resolved pointer geometry and retained resize behavior; the JavaScript application owns selected chart data and presentation. Charts remain native `Path`/`Background` descriptions and allocation colors come only from theme tokens.

**Tech Stack:** Rust, GPUI, gpui-base, QuickJS, JavaScript, Path/Background.

**Spec:** `docs/pointer-resizable-design.md`

## Global Constraints

- Do not expose drawing through gpui-component; use GPUI `Path`, `PathBuilder`, and `Background` through gpui-shell.
- Do not replace gpui-base controls with styled `div` implementations.
- Do not add raw application colors.
- Preserve responsive stacked panes at narrow widths.

---

### Task 1: Complete Resizable exposure

**Files:** `../gpui-component/crates/shell/src/spec.rs`, `materialize.rs`, `materialize/components.rs`, `engine/quickjs/mod.rs`, `typings.rs`, `tests/render.rs`.

**Interfaces:** Produces `h_resizable(id)`, `v_resizable(id)`, `resizable_panel()`, `size`, `size_range`, `visible`, and `on_resize`.

- [ ] Add failing description, typing, and materialization tests for a 60/40 horizontal group.
- [ ] Register constructors, component tags, behavior methods, and declarations.
- [ ] Run focused resizable tests and `cargo test -p gpui-shell --lib`.

### Task 2: Add normalized pointer callbacks

**Files:** `../gpui-component/crates/shell/src/spec.rs`, `materialize.rs`, `engine/quickjs/mod.rs`, `typings.rs`, `tests/render.rs`.

**Interfaces:** Produces `on_mouse_move(handler)` with `PointerMoveEvent` and `on_hover(handler)` with boolean state.

- [ ] Add failing interaction tests for center coordinates and hover exit.
- [ ] Capture resolved bounds during prepaint and dispatch clamped local ratios from GPUI events.
- [ ] Declare the event and callback signatures and run focused plus full shell tests.

### Task 3: Add chart indicator model and presentation

**Files:** `app/chart.js`, `app/chart.test.js`, `app/main.js`, `app/ui.js`, `tests/app_vectors.rs`.

**Interfaces:** Consumes normalized `local_x`; produces `nearestPricePoint(geometry, ratio)` and indicator paths.

- [ ] Add failing pure vectors for clamping and nearest-point ties.
- [ ] Implement nearest-point selection without mutating geometry.
- [ ] Store/clear hover ratio in the view and render guide, marker, timestamp, and price.
- [ ] Run chart vectors and authenticated workspace materialization tests.

### Task 4: Adopt resizable panes and restrained allocation colors

**Files:** `app/main.js`, `app/ui.js`, `app/portfolio_ui.test.js`, `tests/app_vectors.rs`.

**Interfaces:** Consumes Task 1 constructors; produces desktop 60/40 panes and a primary-opacity donut palette.

- [ ] Add failing UI assertions for resizable descriptions and absence of raw allocation colors.
- [ ] Use the resizable group on desktop and preserve the wrapped fallback.
- [ ] Replace allocation hex colors with `tokens.primary` plus opacity in paths and legend markers.
- [ ] Run all application tests, Prettier, and `git diff --check`.

### Task 5: Visual and performance verification

**Files:** no production files unless verification finds a defect.

- [ ] Rebuild and restart the application because shell APIs changed.
- [ ] Verify pane drag, chart hover, and both themes in the live window.
- [ ] Confirm drag does not cause JavaScript rerenders through shell metrics/logging.
- [ ] Run final shell targeted tests and the full Longbridge test suite.
