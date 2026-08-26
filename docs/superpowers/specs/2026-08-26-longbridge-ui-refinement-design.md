# Longbridge UI refinement design

## Objective

Make the read-only Longbridge desktop client feel like a precise native market-data tool. The primary task is scanning the account Watchlist, understanding live state, and inspecting one security without losing position. Portfolio remains a secondary read-only workspace.

## Runtime boundary

`gpui-shell` will gain one generic, stateful vertical-scroll behavior exposed to JavaScript. It will own the native scroll handle and scrollbar behavior, preserve scroll state by stable element identity, and reject invalid use clearly. Existing `transition` and `spring` APIs provide motion; no second animation system will be added.

The Longbridge application owns product composition, responsive rules, copy, data state, and motion policy. It will not gain Watchlist editing or trading commands.

## Window structure

- Use a flat single-workspace shell with compact title/connection chrome, a native tab strip, and one main content region.
- Watchlist uses a master–detail split. The collection has a content-driven minimum and preferred width; the inspector consumes surplus. At narrow widths the inspector moves below or is replaced by a selected-security summary so the list remains usable.
- Only the quote rows scroll. Header, column labels, connection status, tabs, and footer remain fixed.
- Portfolio uses the same alignment spine and gives the holdings collection its own scroll region.
- Avoid nested card decoration. Major regions use one background and hairline boundary; spacing and typography carry hierarchy.

## Watchlist collection

- Preserve `longbridge-terminal` ordering: regular session first, then US, HK, SH/SZ, SG, with stable API order for equal keys.
- Use compact rows with stable lanes for instrument, last, change, volume, and session. Comparable numbers are right-aligned and use tabular numeric treatment when the shell supports it.
- Selected, hovered, focused, stale, waiting, and unavailable states remain distinct without relying on color alone.
- Price direction uses semantic positive/negative color plus a sign. Freshness and session remain textual.
- The header reports the account-derived count and quote coverage without redundant phrases such as “API instruments.”

## Detail inspector

- The selected symbol and current price form the single focal point.
- Metadata and session sit with identity; change sits with price.
- Previous close, open, range, volume, turnover, update time, and data health use an aligned two-column description layout.
- Selection is preserved by symbol while the list reorders on session changes.

## States and feedback

- Loading: stable skeleton rows and a detail placeholder, not a blank surface.
- Empty: explain that the account Watchlist is empty and that changes are made in Longbridge.
- Reconnecting: keep stale quotes visible, show a compact warning/status line, and state the retry delay.
- Partial coverage: distinguish unavailable rows from a disconnected stream.
- Fatal authentication/permission errors: show the recovery action near the connection state.
- Read-only status remains visible but quiet; it is not repeated in every section.

## Motion

Motion explains state changes and remains restrained:

- Tab and selected-row emphasis: 140–180 ms ease-out transition.
- Detail content when selection changes: short opacity transition keyed by symbol; no large pane slide.
- Connection indicator: opacity transition between states; waiting may pulse subtly, while streaming is still.
- Fresh quote updates: brief semantic emphasis on the changed numeric cell, never continuous flashing and never layout movement.
- Error/status appearance: short opacity transition without moving the full workspace.
- All motion uses stable domain identities, reverses from the sampled value, and inherits gpui-base reduced-motion behavior.

## Interaction and accessibility

- Tabs and quote rows are keyboard reachable with visible focus.
- Selection remains persistent and distinct from hover.
- Pointer and keyboard activation produce the same result.
- Scroll belongs to the row region and its scrollbar remains on that region’s trailing edge.
- Theme tokens and relative scale helpers replace ordinary raw geometry where supported; the interface is verified in light/dark themes, at minimum window size, and with longer names.

## Verification

- Add gpui-shell tests proving the new scroll behavior is accepted, materializes native scrolling, preserves identity, and remains absent from unsupported elements.
- Add an application runtime test that renders the authenticated Watchlist path with many rows, catching unknown-method errors.
- Extend UI vectors for hierarchy, empty/loading/reconnecting states, stable columns, and motion declarations.
- Run formatting, clippy with warnings denied, and all tests in both repositories.
- Run the real application with the account Watchlist, exercise scrolling, selection, reconnect feedback, light/dark themes, and representative narrow/default window sizes.
