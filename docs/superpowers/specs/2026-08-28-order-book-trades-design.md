# Order Book and Time & Sales Design

## Scope

Add live order-book depth and time-and-sales data to the selected instrument in
Longbridge Lite. The feature remains read-only and extends the existing binary
Longbridge quote WebSocket rather than adding polling or embedding another SDK.

The Stock Details scrolling column gains two permanent panels after the price
chart:

1. **Order Book** — five asks, a bid/ask volume-ratio bar, and five bids.
2. **Time & Sales** — the latest 20 trades, newest first.

The panels are consecutive content, not tabs and not collapsible sections.

## Reference Behavior

Data shapes and visual calculations follow `../longbridge-terminal`:

- A depth level carries `position`, optional `price`, `volume`, and
  `order_num`.
- Asks render in reverse display order so the best ask meets the ratio bar;
  bids render in source order so the best bid also meets the bar.
- The ratio bar uses total visible bid and ask volume.
- A trade carries `price`, `volume`, `timestamp`, `trade_type`, and direction.
- Trade volume bars use `sqrt(abs(volume) / max_abs_volume)` so one large trade
  does not make all smaller trades visually disappear.

The implementation ports behavior and field semantics, not terminal-specific
layout code.

## Subscription Architecture

The existing Watchlist subscription remains Quote-only for every watchlist
symbol. Exactly one symbol—the current Stock Details selection—also receives
Depth and Trades.

When the selected symbol changes:

1. Increment a detail-data generation number.
2. Clear depth and trades from the previous symbol immediately.
3. Unsubscribe Depth and Trades from the previous symbol when connected.
4. Subscribe Depth and Trades for the new symbol.
5. Request initial depth and recent-trades snapshots for the new symbol.
6. Publish a response only when its symbol and generation still match.

Quote remains subscribed throughout this transition. A stale snapshot or push
for the previous symbol is ignored, preventing a fast selection change from
painting data under the wrong security.

Reconnect restores both subscription scopes: Quote for the Watchlist, then
Depth and Trades plus snapshots for the selected symbol. Stop and sign-out
reject pending requests and clear detail market data.

## Protocol and Stream Boundaries

`app/protocol.js` owns the protobuf wire shapes and exports normalized codecs
for:

- Depth and Trades subscription flags.
- Subscription and unsubscription requests.
- Initial security-depth request and response.
- Initial security-trades request and response.
- Depth push payloads.
- Trades push payloads.

All 64-bit quantities and timestamps remain `BigInt` until presentation.
Decimal prices remain strings to avoid floating-point precision loss.
Unknown protobuf fields are skipped so compatible upstream additions do not
break decoding.

`app/quote_stream.js` owns request correlation and connection lifecycle. It
exposes a detail-subscription operation and snapshot queries, and emits
normalized `onDepth` and `onTrades` callbacks. Protocol code does not own UI
state; stream code does not format values.

## State and Data Flow

`app/main.js` owns:

- `depthState`: symbol, status, bids, asks, and optional error.
- `tradesState`: symbol, status, trades, and optional error.
- A detail-data generation number.

Depth pushes replace the complete visible book for their symbol. Trade pushes
prepend new records, de-duplicate records with the same stable trade identity,
sort newest first, and retain at most 20 entries. Snapshot data is normalized
through the same reducers as push data.

Depth and trade updates redraw the parent view but do not rebuild the retained
price-chart child unless chart inputs changed.

## UI

Both panels use the existing `panel`, typography, spacing, and semantic theme
tokens. They align to the same Stock Details content inset as Quote and Chart.

### Order Book

- Header: `Order Book`, with a muted live/loading/error status.
- Five ask rows in descending display order.
- A dual-color ratio bar: bid uses the positive market color and ask uses the
  negative market color. Text labels include percentages, so color is not the
  only signal.
- Five bid rows in ascending proximity from the ratio bar.
- Columns: level, price, volume; show order count when present.
- Missing levels keep their row height so the ratio bar does not jump.

### Time & Sales

- Header: `Time & Sales`, with a muted count/status.
- Up to 20 rows, newest first.
- Columns: local market time, direction marker, price, volume.
- Direction uses arrow plus semantic market color; neutral trades use muted
  foreground.
- The volume cell has a right-aligned themed background bar using square-root
  scaling. The number stays legible over the bar.

The Stock Details outer scrollbar owns vertical overflow. Neither panel adds a
nested vertical scrollbar.

## Loading, Empty, and Error States

Each panel reports its own state without replacing Quote or Chart:

- Loading: a compact muted message occupying the panel body.
- Empty: `No order book data` or `No recent trades`.
- Error: a concise local error with reconnect as the recovery path.

An unavailable market-data entitlement is treated as a panel error, not as a
lost login session. Switching symbols clears the error and starts the new
request.

## Testing

- Protocol vectors for depth/trade requests, responses, pushes, unknown fields,
  signed quantities, and decimal precision.
- Stream tests for subscribe order, unsubscribe on selection change, reconnect
  restoration, snapshot correlation, and stale-generation rejection.
- Pure reducer tests for ask/bid ordering, ratio calculation, trade
  de-duplication, 20-row retention, and square-root volume scaling.
- GPUI rendering vectors for both panels, loading/empty/error states, semantic
  colors, column alignment, and the absence of nested scrolling.
- Regression tests confirming Watchlist Quote streaming and the retained chart
  invalidation boundary still behave as before.

## Out of Scope

- Broker queues.
- More than five visible depth levels or 20 visible trades.
- User-configurable panel counts or ordering.
- Trading controls, order entry, or account mutations.
- Historical tick storage across application restarts.
