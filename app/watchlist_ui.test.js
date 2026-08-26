import { View, v_flex } from "gpui";

import { quoteDetail, quoteRow, watchlistHeader } from "./ui.js";

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
    return v_flex()
      .child(watchlistHeader(tokens))
      .child(quoteRow(tokens, quote, true, () => {}, quote.receivedAt + 5_000))
      .child(quoteDetail(tokens, quote, quote.receivedAt + 5_000));
  }
}
