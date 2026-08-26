# Native Path Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native GPUI Path drawing to gpui-shell and use it for five-day Stock Details and currency-safe Portfolio allocation charts.

**Architecture:** gpui-shell snapshots immutable path commands from JavaScript and materializes them through `gpui::PathBuilder` and `Window::paint_path`. The Longbridge application owns candle transport, market-time normalization, chart geometry, caching, and responsive composition.

**Tech Stack:** Rust, GPUI, gpui-shell QuickJS runtime, JavaScript, Longbridge protobuf WebSocket protocol, Node test runner.

**Spec:** `docs/charts-design.md`

## Global Constraints

- Expose GPUI `Path`/`PathBuilder` directly; do not expose gpui-component charts.
- Keep all Longbridge access read-only.
- Request one-minute candles for intraday sessions and retain five actual market-local trading days.
- Never combine portfolio values across currencies without FX conversion.
- Do not add files under `docs/superpowers`.

---

### Task 1: gpui-shell Path surface

**Files:**
- Modify: `../gpui-component/crates/shell/src/engine/quickjs/mod.rs`
- Modify: `../gpui-component/crates/shell/src/snapshot.rs`
- Modify: `../gpui-component/crates/shell/src/materialize.rs`
- Modify: `../gpui-component/crates/shell/src/typings.rs`
- Test: `../gpui-component/crates/shell/src/tests/snapshot.rs`
- Test: `../gpui-component/crates/shell/src/tests/render.rs`

**Interfaces:**
- Produces: global `PathBuilder` whose chainable commands end in an immutable `build(): Path`.
- Produces: immutable `Background` values and `paint_path(path, background): Element`.
- Produces: immutable snapshot path commands with pixel or percentage coordinates.

- [ ] Add failing runtime and snapshot tests that construct a filled closed path and a stroked dashed path, then verify command order, coordinates, paint, and declarations.
- [ ] Run the focused gpui-shell tests and confirm they fail because `PathBuilder` is absent.
- [ ] Add the minimal QuickJS builder, snapshot value types, Path element, GPUI materialization, and generated declarations.
- [ ] Run focused tests, then the full gpui-shell test suite and formatting checks.

### Task 2: Longbridge history-candlestick query

**Files:**
- Modify: `app/protocol.js`
- Modify: `app/protocol.test.js`
- Modify: `app/quote_stream.js`
- Modify: `app/quote_stream.test.js`

**Interfaces:**
- Produces: `encodeHistoryCandlesticksRequest(query)` and `decodeCandlesticksResponse(bytes)`.
- Produces: `quoteStream.historyCandlesticks({ symbol, startDate, endDate })` using command 27, period 1, no-adjust 0, intraday session 0.

- [ ] Add failing protobuf vector tests for command 27 date-query encoding and candle decoding.
- [ ] Run the focused protocol tests and confirm missing exports fail.
- [ ] Implement the minimal protobuf fields and expose the authenticated stream query method.
- [ ] Add a failing stream test proving query responses are decoded and unavailable sessions reject safely.
- [ ] Implement stream request plumbing and run focused plus full JavaScript tests.

### Task 3: Five-day market-series model

**Files:**
- Create: `app/chart.js`
- Create: `app/chart.test.js`
- Modify: `app/market.js`
- Modify: `app/market.test.js`

**Interfaces:**
- Produces: `fiveDaySeries(candles, symbol)` returning five market-local day groups.
- Produces: `lineChartGeometry(days, width, height)` returning stroke/fill commands, labels, extrema, and stable domains.
- Produces: `mergeLiveQuote(series, quote, symbol)` updating only the active minute.

- [ ] Add failing tests for US, HK, CN, and SG timezone boundaries, weekends, five-day trimming, flat series, day gaps, and live-minute replacement.
- [ ] Run the focused tests and verify each fails for the missing model.
- [ ] Implement timezone mapping, normalized series, stable geometry, and live merge without UI dependencies.
- [ ] Run focused and full JavaScript tests and format the new module.

### Task 4: Stock Details chart integration

**Files:**
- Modify: `app/main.js`
- Modify: `app/workspace_ui.test.js`
- Modify: `app/types.d.ts`

**Interfaces:**
- Consumes: `quoteStream.historyCandlesticks`, `fiveDaySeries`, `lineChartGeometry`, and gpui-shell `PathBuilder`.
- Produces: cached, generation-safe five-day chart state for the selected symbol.

- [ ] Add failing UI contract tests for fixed-height loading/error/empty/chart states, semantic colors, five date labels, and monospace price labels.
- [ ] Run the focused UI test and confirm the chart contract is absent.
- [ ] Add selection-generation, per-symbol cache, live merge, and responsive chart rendering below the headline quote.
- [ ] Run focused and full application tests, then Prettier checks.

### Task 5: Currency-safe allocation model and donut

**Files:**
- Modify: `app/portfolio.js`
- Modify: `app/portfolio.test.js`
- Modify: `app/main.js`
- Modify: `app/portfolio_ui.test.js`

**Interfaces:**
- Produces: `allocationByCurrency(holdings, quotes)` with priced slices, totals, percentages, and unpriced holdings.
- Consumes: gpui-shell `PathBuilder` arc paths.

- [ ] Add failing model tests proving currencies stay separate, percentages total 100 per priced currency, zero values are safe, and unpriced items are reported.
- [ ] Run focused tests and confirm the allocation API is missing.
- [ ] Implement the allocation model and run focused tests.
- [ ] Add failing UI contracts for donut paths, legends, unpriced copy, theme colors, and responsive stacking.
- [ ] Render one donut per currency and run focused plus full tests and formatting checks.

### Task 6: End-to-end verification

**Files:**
- Modify only files required by defects found during verification.

**Interfaces:**
- Consumes: all preceding tasks.
- Produces: a hot-reloadable demo with native Path charts and no regressions.

- [ ] Run all app tests, `cargo test`, gpui-shell tests, Rust formatting, and JavaScript formatting checks.
- [ ] Start the debug application, verify hot reload observes `app` changes, and inspect both themes and responsive widths.
- [ ] Check `git diff --check` and review the final diff for unrelated sibling-repository changes before reporting completion.
