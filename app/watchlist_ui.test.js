import { View } from "gpui";
import { Table, v_flex } from "gpui-base";
import { menuTrigger, quoteDetail, quoteRow, watchlistHeader } from "./ui.js";

export default class WatchlistUiProbe extends View {
  render(cx) {
    const tokens = cx.theme();
    const quote = {
      symbol: "AAPL.US",
      code: "AAPL",
      name: "Apple",
      market: "US",
      currency: "USD",
      last: "188.00",
      prevClose: "180.00",
      open: "182.50",
      high: "190.25",
      low: "181.00",
      volume: 8_589_934_592n,
      turnover: "1590000000.50",
      tradeStatus: 0,
      tradeSession: 0,
      sequence: 42n,
      updatedAt: 1_700_000_000_000,
      receivedAt: 1_700_000_001_000,
      change: "+8.00",
      changePercent: "+4.44%",
    };
    return (
      v_flex()
        // A row and a header are table parts now, so the probe puts them in the
        // table they belong to rather than loose in a column.
        .child(
          Table.new("probe-watchlist")
            .row_count(2)
            .column_count(5)
            .flex()
            .flex_col()
            .child(watchlistHeader(tokens))
            .child(quoteRow(tokens, quote, true, 0, quote.receivedAt + 5_000)),
        )
        // Open, so the probe draws every reading the pane can show. The
        // closed half of the disclosure is `detail_ui.test.js`, which is where
        // the pane owns the state.
        .child(quoteDetail(tokens, quote, quote.receivedAt + 5_000, 1, { open: true }))
        // The compact pair is the narrow dock contract: never squeeze the
        // secondary columns into the Instrument/Last lanes.
        .child(
          Table.new("probe-watchlist-compact")
            .row_count(2)
            .column_count(2)
            .flex()
            .flex_col()
            .child(watchlistHeader(tokens, true))
            .child(quoteRow(tokens, quote, true, 0, quote.receivedAt + 5_000, true)),
        )
        // Closed then open, so the difference between the two is what the test
        // reads rather than one absolute colour.
        .child(menuTrigger(tokens, "probe-menu-closed", "Closed"))
        .child(menuTrigger(tokens, "probe-menu-open", "Open", true))
    );
  }
}
