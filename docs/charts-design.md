# Native Path Charts Design

## Goal

Demonstrate gpui-shell's native drawing support with a five-day intraday price chart in Stock Details and currency-safe asset-allocation donut charts in Portfolio.

## Constraints

- Expose GPUI's `Path` and `PathBuilder` capabilities directly through gpui-shell.
- Do not expose or depend on gpui-kit chart components; they are API references only.
- Keep application chart data and layout in JavaScript.
- Use Longbridge read-only quote commands only.
- Preserve the original watchlist order within each market group.

## Path and Background API

gpui-shell provides a declarative JavaScript `PathBuilder` with `fill`, `stroke`, `move_to`, `line_to`, `curve_to`, `cubic_bezier_to`, `arc_to`, `add_polygon`, `close`, `dash_array`, and `build`. `build()` returns an immutable Path value rather than an Element. `Background` separately exposes GPUI solid, two-stop linear-gradient, slash-pattern, and checkerboard values, including opacity and color-space transforms. `paint_path(path, background)` combines the two into a styleable Element. During GPUI prepaint/paint, gpui-shell resolves pixel and percentage coordinates against the element bounds, creates a `gpui::Path` with `gpui::PathBuilder`, and calls `Window::paint_path` with the resolved `gpui::Background`.

Numbers are pixels relative to the path element's top-left. Percentage strings are relative to its resolved bounds. Hover state belongs to the stable chart container rather than the path description.

## Five-day intraday data

The quote protocol adds command 27 (`GET_SECURITY_HISTORY_CANDLESTICKS`) with a date query for one-minute, no-adjust, intraday-only candles. The application requests a calendar range large enough to contain five trading days, groups timestamps in the symbol market's timezone, and retains the newest five actual trading dates.

Selection changes use a monotonically increasing generation so late responses for a previous symbol cannot replace the current chart. Successful responses are cached per symbol. Live quote pushes update only the latest plotted minute; static Stock Details labels do not flash.

The chart uses separate filled and stroked paths, a stable vertical range, visible day gaps, date labels, high/low labels, and loading, empty, and error states with identical height.

## Asset allocation

Portfolio market values are not combined across currencies without FX data. Each currency receives its own donut and legend. Slices represent priced holdings by market value; holdings without a valid market value are excluded and reported as unpriced. Wide layouts place donut and legend side by side, while narrow layouts stack them.

Chart category colors come from the application palette and never reuse gain/loss colors as category semantics.

## Verification

Protocol codecs, trading-day trimming, stale-response protection, chart geometry, currency grouping, and empty states receive automated tests. Rust tests cover JavaScript Path construction, snapshot conversion, GPUI materialization, and generated TypeScript declarations. Final verification runs JavaScript tests, Rust tests, formatting checks, and the development application with hot reload.
