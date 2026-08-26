# Where One Script Render Goes

A measured breakdown of the ~11 ms script render observed with
`LONGBRIDGE_PROFILE=1` during a live session.

**Answer up front:** the 11 ms is the five-day intraday chart, and essentially
nothing else. One script render costs

```
0.8 ms + 0.0305 ms x (candles cached for the selected symbol)
```

Every other suspect — the portfolio arithmetic, the two array spreads in
`portfolioPage`, the watchlist rows — is under half a millisecond combined.

## What was measured, and against what

- **Source under test:** `app/` at commit `caed4d9`, with the temporary render
  probes that commit accidentally carried removed (they call a `log` global the
  runtime no longer exposes). That is the state the 11 ms reading came from.
- **Runtime:** `gpui-shell` from the sibling working tree, snapshotted so it
  could not move mid-run.
- **Instrument:** the runtime's own `RuntimeMetrics::script_render_time`,
  divided by `script_renders` — the same counter `src/main.rs` prints. Each
  figure is the best of three batches; batch means drift with machine load, the
  smallest is the closest to the cost with nothing else in the way.
- **Method:** fixture views load the real `main.js`, subclass `LongbridgeApp`,
  and replace only `init()` so state can be set without a network. `render` is
  the application's own. Kernel fixtures repeat one function inside one render
  and divide out.
- **Scale:** 54 watchlist instruments (the real account's unique symbols across
  all groups), 14 holdings, 68 quotes into the portfolio functions, and a
  candle count swept from 30 to 3900.
- **Profile:** `dev`, but `gpui`, `gpui-base`, `gpui-shell` and `rquickjs` are
  all `opt-level = 3` there, so every line on the measured path is optimized.

Nothing was added to tracked files: fixtures and harness live outside the
repository.

## The whole render, by application state

Script render, milliseconds:

| State | ms |
| --- | ---: |
| Signed out (login gate) | 0.21 |
| Watchlist, no rows, no chart | 0.52 |
| Watchlist, 54 rows, chart still loading | 0.79 |
| Watchlist + chart, 30 candles | 1.80 |
| Watchlist + chart, 100 candles | 3.81 |
| Watchlist + chart, 200 candles | 6.73 |
| Watchlist + chart, 390 candles | 12.57 |
| Watchlist + chart, 975 candles | 30.20 |
| Watchlist + chart, 1300 candles | 40.40 |
| Watchlist + chart, 1600 candles | 49.55 |
| Watchlist + chart, 1950 candles | **aborted — over the runtime's 50 ms render budget** |
| Portfolio page | 3.55 |

The fit is affine and tight: `0.76 + 0.0305 * candles`.

### This explains both readings

Inverting the fit against the numbers from the live session:

| Observed | Implied candles |
| --- | ---: |
| 2.4 ms at start-up | ~54 |
| 11.0 ms steady state | ~336 |
| 11.3 ms before the drop | ~346 |
| 1.7 ms after the drop | ~31 |

So **11.3 ms → 1.7 ms is not a page change and not a mystery: it is the chart
losing its data**, or the selection moving to a symbol with almost no intraday
history. `stockDetail` reads
`this.candleCache.get(quote.symbol) ?? []`, and `selectQuote` → `loadSelectedChart`
sets `chartState` to `loading` for an uncached symbol, so the render falls back
to the 0.79 ms empty-chart path until the response lands. Render frequency rose
from 11/s to 30/s at the same moment for the obvious reason: cheaper renders let
the event loop drain more quote pushes per second.

It is *not* the Portfolio page — that is 3.55 ms, which matches neither reading.

### There is a cliff, not just a slope

The runtime aborts any script render over 50 ms (`sandbox.rs`, `Budgets::render`).
At 1600 candles the render is 49.55 ms; at 1950 it is interrupted. The threshold
is ~1615 candles.

Five full US trading days of regular-session one-minute candles is 390 x 5 =
**1950 points** — past the cliff. The chart only works today because the API is
returning well under a day's worth for the symbols in play. A liquid symbol with
complete one-minute history would not render slowly; it would fail.

## Where the chart's cost goes

At 390 candles, the 12.57 ms render decomposes as:

| Component | ms | share |
| --- | ---: | ---: |
| `prepareFiveDaySeries` | 3.90 | 31% |
| `layoutPriceSeries` | 1.11 | 9% |
| `priceChart` description tree | 6.51 | 52% |
| Everything else on the page | 0.79 | 6% |

All three chart terms are linear in the number of points:

| Points | `prepareFiveDaySeries` | `layoutPriceSeries` | `priceChart` tree |
| ---: | ---: | ---: | ---: |
| 0 | — | — | 0.03 |
| 100 | — | — | 1.78 |
| 240 | — | — | 4.13 |
| 390 | 3.90 | 1.11 | 6.51 |
| 975 | 9.88 | 2.78 | 16.38 |
| 1300 | — | — | 23.94 |
| 1600 | — | — | 27.00 |
| 1950 | 19.77 | 5.56 | ~33 |
| 3900 in (1950 out) | 36.37 | 5.55 | 33.40 |

Per unit: `prepareFiveDaySeries` ~10.0 µs **per input candle** (it pays for the
full two-week response, not the five days it keeps), `layoutPriceSeries`
~2.9 µs per output point, `priceChart` ~16.7 µs per plotted point.

`prepareFiveDaySeries` is expensive because `dateKey` allocates roughly five
`Date` objects for every candle: one for the local day, one inside
`newYorkOffsetSeconds` for the year, and two more inside each `nthSundayUtc`
call. QuickJS charges real calendar arithmetic for each.

### Inside `priceChart`: it is not the number of boundary crossings

The obvious theory — "every `.child()` and every builder call is a JS→Rust
crossing, so 390 `line_to` calls are the cost" — is measurably wrong.

At 390 points, of 6.51 ms:

| Step | ms | per point |
| --- | ---: | ---: |
| 780 `percentage()` template strings | 0.82 | 2.1 µs |
| 390 separate `PathBuilder.line_to` calls | 1.94 | 5.0 µs |
| **one** `add_polygon(390 points)` call | 2.34 | **6.0 µs** |
| Remainder (`build`, gradient, labels, container) | 1.41 | — |

One `add_polygon` handing the whole list across in a single crossing costs
*more per point* than 390 individual `line_to` crossings. The cost is
per-point marshalling and percent-string parsing on the Rust side, not the
crossing count. Batching builder calls will not help; **reducing the number of
points will.**

## What is not the problem

The suspicion in the brief was `portfolioPage`'s two full array spreads and the
two `new Map(quotes.map(...))` inside the functions they feed. Measured:

| Kernel | ms |
| --- | ---: |
| `portfolioPresentation(14 holdings, 68 quotes)` | 0.159 |
| `allocationInUsd(14 holdings, 68 quotes)` | 0.091 |
| The two `[...this.quotes, ...this.portfolioQuotes]` spreads alone | **0.009** |
| Both calls plus both spreads, as `portfolioPage` runs them | 0.263 |

0.263 ms is 2.1% of a 12.57 ms watchlist render and 7.4% of the 3.55 ms
Portfolio render. The double spread by itself is 0.009 ms — 0.07%. Deduplicating
it is correct hygiene and worth nothing measurable.

The Portfolio page's own 3.55 ms is mostly description tree, not arithmetic:
`allocationChart` 1.68 ms (donut wedges, ~110 polygon points), 14 `holdingRow`
trees 1.06 ms, the compute pair 0.26 ms, chrome the rest.

Baselines for scale: an empty render is 0.0042 ms; the whole signed-out login
gate is 0.21 ms.

### One thing that is not in the render but should be watched

`sortLikeTerminal(54 quotes)` costs **0.44 ms**, and `receiveQuote` calls it on
every single quote push, plus once a second from the clock timer. At 30 pushes
per second that is ~13 ms of JavaScript per second spent outside `render`, which
`script_render_time` does not see at all. It is not part of the 11 ms, but it is
real work on the same thread, and the market session ranking it recomputes
changes at most a few times a day.

## What to do, in order of payoff

Numbers are the effect on a 12.57 ms render at 390 candles.

1. **Downsample the plotted series to the chart's pixel width. −2.4 ms now, and
   it removes the cliff.**
   The plot is 480 px wide. At 390 points there are already fewer than two
   pixels per point; at 1950 there are four points per pixel, all invisible.
   Capping at ~240 points makes `priceChart` 4.13 ms instead of 6.51 ms, and —
   far more importantly — makes it **constant** regardless of how much history
   arrives. This is the only change that stops a liquid symbol from blowing the
   50 ms budget. Do it in `layoutPriceSeries`, which already walks every point.

2. **Land the `chart.js` rewrite already sitting in the working tree.
   12.57 ms → 7.82 ms.**
   Measured directly by running the committed application against the working
   tree's `chart.js`: `prepareFiveDaySeries` + `layoutPriceSeries` drop from
   5.08 ms to 0.004 ms at 390 candles — a ~1400x reduction, from caching the
   New York DST bounds per year and grouping on an integer day number instead of
   a formatted string. Whole-render effect, same fixtures:

   | Candles | committed | + working-tree `chart.js` |
   | ---: | ---: | ---: |
   | 30 | 1.80 | 1.41 |
   | 100 | 3.81 | 2.59 |
   | 200 | 6.73 | 4.38 |
   | 390 | 12.57 | 7.82 |
   | 975 | 30.20 | 17.69 |

   Note what this does *not* fix: after it, `priceChart` is 83% of the chart's
   cost and the 50 ms cliff has only moved out to ~2900 points. Step 1 is still
   required.

3. **Memoize the chart geometry.** With 1 and 2 done, the derived pipeline is
   ~0.004 ms and memoizing it buys nothing. But the downsample from step 1 is
   itself per-render work over every input candle, so cache the result keyed by
   symbol, candle count and plot size, and invalidate it where `mergeLiveQuote`
   already rewrites the last minute.

4. **Take `sortLikeTerminal` off the quote-push path.** 0.44 ms per push, ~13 ms
   per second at 30 pushes/s. The session ranks it derives change a few times a
   day; the sort order only changes when they do. Not part of the 11 ms — but it
   is the largest remaining per-second JavaScript cost once the chart is fixed.

5. **Skip closed `Popover` content.** `watchlistMenu` and `allocationHelp` build
   their full content trees on every render whether open or not. Bounded above by
   0.52 ms, since that is the entire chart-free watchlist page including them.
   Cheap to do, small to gain — do it last, or not at all.

6. **Do not bother deduplicating `portfolioPage`'s array spreads for speed.**
   0.009 ms. Do it for clarity if you like.

At 390 candles, steps 1 and 2 together take the render from **12.57 ms to
about 5.0 ms** and make it flat in history length — inside the 8.33 ms budget
for 120 FPS with room for the ~1.2 ms materialize.

## What could not be measured, and why

- **The split between "JavaScript" and "boundary crossing" inside
  `script_render_time`.** `RuntimeMetrics::native_time` read 0.000 ms in every
  single fixture: it counts host-module calls like `native("market").quotes()`,
  not element-builder crossings. The runtime exposes no counter that separates
  them. The `line_to` versus `add_polygon` comparison above is the closest
  available proxy, and it argues the crossing count is not the driver.
- **Materialize and the virtual list, directly.** This harness drives
  `render_to_spec`, which builds the description and never materializes it. The
  live reading of ~1.2 ms is corroborated indirectly: 54 `quoteRow` trees cost
  5.07 ms, i.e. 94 µs each, and a 760 px window shows about 12 rows at
  `QUOTE_ROW_HEIGHT = 44`, giving ~1.1 ms. Note that per `metrics.rs`, virtual
  list item rendering is charged to `materialize_time`, not to
  `script_render_time` — so those rows were never part of the 11 ms.
- **How many candles the Longbridge API actually returns** for the app's
  14-calendar-day, one-minute, `queryType = 2` request. No live session was
  available here. Rather than guess, everything above is stated as a function of
  that count, and the live readings are inverted against it: 11.3 ms implies
  roughly 346, 1.7 ms roughly 31.
- **Anything about the current working tree beyond `chart.js`.** `app/` was
  being actively rewritten during this measurement (a filter/Table feature,
  application-owned `theme.json`). Numbers here describe `caed4d9` plus, in
  step 2, that one substituted module.

## Reproducing

The harness is a scratch cargo package outside this repository holding one
integration test that loads fixture views from a scratch copy of `app/`:

- `tests/render_cost.rs` — loads each fixture, renders it N times through
  `ShellRuntime::render_to_spec`, and reports `RuntimeMetrics` deltas.
- `b_*.js` — kernel fixtures, each repeating one function inside one render.
  The repeat count is read out of the fixture by the harness so the two cannot
  drift.
- `f_*.js` — full-render scenarios: `class Scenario extends LongbridgeApp` with
  only `init()` replaced.

Two rules made it safe to run against a repository being committed to live:
fixtures are a copy of `app/` in a scratch directory, and the application's own
sources are never edited. Keep it that way — a probe added to `app/main.js` for
"just one run" is how `caed4d9` ended up carrying one.
