# Intraday and Candlestick Chart Modes Design

## Scope

Extend the retained Stock Details chart with selectable line and candlestick
views while preserving the current five-day line chart as the default.

The compact selector contains:

- `Intraday` — a full-session line chart.
- `5D` — the existing five-day intraday line chart and default mode.
- `1m`, `5m`, `15m`, `1D` — OHLC candlestick charts.

This project is independent of the Order Book and Time & Sales project. They
share selected-symbol and theme inputs but neither feature depends on the
other's protocol or state.

## Chart Architecture

The existing retained price-chart child becomes a retained `MarketChartView`.
It owns hover state and chart geometry and selects a renderer from its current
mode. Keeping one retained boundary preserves the existing guarantee that an
unrelated quote update does not rebuild expensive chart geometry.

The view contains two focused renderers:

- A line renderer shared by Intraday and 5D.
- A candlestick renderer shared by 1m, 5m, 15m, and 1D.

Renderers receive normalized immutable series and semantic theme colors. They
do not request data, mutate application state, or interpret protocol fields.

## Intraday Definition

Intraday means the complete trading day available from Longbridge, including:

1. Overnight trading.
2. Pre-market trading.
3. Regular trading.
4. Post-market trading.

No extended-hours segment is discarded. Session membership comes from
Longbridge's `trade_session` field, never from local-clock heuristics. An
overnight segment that crosses a calendar boundary remains associated with the
corresponding market trading day.

The line is continuous in chronological order. Each session is distinguishable
without relying only on color:

- Regular trading uses the full semantic market tone.
- Overnight, pre-market, and post-market use progressively quieter opacity.
- A hairline and compact label mark each session boundary.
- A previous-close reference line and current-price marker remain visible.

The tooltip displays trading date, market-local time, session name, and price.

## Five-Day Line Mode

The 5D mode preserves the current five-session line chart, layout, hover
behavior, date axis, and default selection. It continues to use regular-session
candles so the historical comparison is not distorted by markets with
different extended-hours availability.

## Candlestick Modes

Candlestick modes display approximately 120 recent bars at every period. A
stable bar count keeps candle width readable in the narrow Stock Details pane.

- `1m`: approximately two hours.
- `5m`: approximately one to two trading days.
- `15m`: approximately five trading days.
- `1D`: approximately six months.

Each candle renders body and wick from exact OHLC values. Up, down, and neutral
candles use semantic market colors derived from the current Omarchy theme.
Direction is also represented geometrically by open/close body placement.

The candlestick tooltip displays market-local time, open, high, low, close,
volume, and session when applicable.

Regular OHLC modes exclude extended-hours candles by default. Extended-hours
data is retained in normalized inputs so adding an explicit extended-hours
candlestick mode later does not require changing the protocol boundary.

## Controls and Layout

A compact segmented control above the chart presents
`Intraday · 5D · 1m · 5m · 15m · 1D`. Selection is persistent application
state for the current session; it is not written to login storage.

The selector has one row. When the Stock Details pane is too narrow, the
selector scrolls horizontally instead of wrapping and consuming chart height.

The existing end-date control remains:

- Intraday interprets it as the trading day to display.
- 5D interprets it as the last session in the five-session window.
- Candlestick modes interpret it as the end of the approximately 120-bar
  window.

The chart, controls, axis, and tooltip use only semantic theme colors. Theme
hot reload rebuilds paint geometry without refetching unchanged market data.

## Protocol and Data Requests

Extend the existing candlestick request codec with Longbridge's period field.
The normalized period is one of `1m`, `5m`, `15m`, or `1D`; Intraday and 5D use
the smallest available intraday source needed to construct their line series.

Responses retain exact decimal strings, integer volume, timestamp, and
`trade_session`. Unknown protobuf fields are skipped for forward compatibility.

Chart request identity is:

`symbol + mode + period + endDate`

The application increments a chart generation whenever any identity field
changes. A response publishes only if both identity and generation still
match, preventing rapid mode, date, or symbol changes from painting stale
data.

Completed normalized responses are cached by request identity for the running
application session. The cache is bounded to the most recent chart requests
and contains no login material.

## Live Updates

The latest Quote push updates only the active chart series:

- Intraday appends or updates the current minute while retaining its session.
- 5D keeps the existing regular-session live-tail behavior.
- 1m, 5m, and 15m update the active period bucket's OHLC and volume.
- 1D updates the current trading day's OHLC and volume.

Out-of-order pushes older than the active bucket do not rewrite later bars.
Live merging is pure and independently tested.

## Loading, Empty, and Error States

Changing mode keeps the chart frame stable and shows a compact in-place loading
state. Empty and failed requests identify the selected mode and retain the
controls so the user can choose another mode or date. A chart entitlement or
history error does not disconnect the live Quote stream.

## Testing

- Protocol vectors for every period and retained session field.
- Pure normalization tests for full-session Intraday ordering across calendar
  boundaries and all four session types.
- Windowing tests for approximately 120 candles per candlestick mode.
- Live-merge tests for minute, multi-minute, and daily buckets, including
  out-of-order pushes.
- Geometry tests for candle bodies, wicks, flat candles, line segmentation,
  previous-close reference, and session boundaries.
- GPUI rendering vectors for selector state, horizontal overflow, tooltips,
  semantic colors, loading/empty/error states, and theme hot reload.
- Regression tests for the retained-child invalidation boundary and the
  existing default 5D view.

## Out of Scope

- Technical indicators or drawing tools.
- User-configurable candle count.
- Persisting chart mode across application restarts.
- Extended-hours OHLC candle modes; extended hours remain fully available in
  Intraday.
- Historical tick storage.
