// The stock-detail pane, drawn from the base components PR #2847 bound in:
// the accordion parts around the always-mounted chart, the avatar's fallback slot, and a month grid
// read off a retained `CalendarState`.

import { v_flex } from "gpui-base";
import LongbridgeApp from "./main.js";

const QUOTE = Object.freeze({
  symbol: "AAPL.US",
  code: "AAPL",
  name: "Apple Inc.",
  market: "US",
  currency: "USD",
  last: "188.00",
  prevClose: "185.00",
  open: "185.50",
  high: "189.25",
  low: "184.75",
  volume: 1_000_000n,
  turnover: "2000000",
  tradeStatus: 0,
  tradeSession: 0,
  sequence: 7n,
  updatedAt: 1_700_000_000_000,
  receivedAt: 1_700_000_001_000,
  change: "+3.00",
  changePercent: "+1.62%",
});

export default class DetailUiProbe extends LongbridgeApp {
  init(_props, cx) {
    // A probe replaces init wholesale, so it owes the view the state a render
    // reaches for unconditionally.
    this.initInteractionState();
    this.initChartCalendar(cx);
    this.quotes = [QUOTE];
    this.instruments = [
      { symbol: QUOTE.symbol, code: QUOTE.code, name: QUOTE.name, market: QUOTE.market },
    ];
    this.selectedSymbol = QUOTE.symbol;
    this.page = "watchlist";
    this.hasStoredTokens = true;
    this.status = { state: "connected" };
    this.authorization = null;
    this.account = null;
    this.fxRates = new Map([["USD", 1]]);
    this.holdings = [];
    this.error = "";
    this.streamError = "";
    this.stream = null;
    this.streamGeneration = 0;
    this.connectedToken = "test";
    this.lastTick = 1_700_000_006_000;
    this.quotePulse = 1;
    this.candleCache = new Map();
    this.chartState = { symbol: this.selectedSymbol, state: "ready" };
    this.chartGeneration = 0;
    this.chartThemeRevision = 0;
    this.depthState = {
      symbol: this.selectedSymbol,
      status: "ready",
      asks: [
        { position: 1, price: "188.10", volume: 400n, orderNum: 8n },
        { position: 2, price: "188.20", volume: 300n, orderNum: 5n },
      ],
      bids: [
        { position: 1, price: "188.00", volume: 900n, orderNum: 12n },
        { position: 2, price: "187.90", volume: 100n, orderNum: 2n },
      ],
      error: "",
    };
    this.tradesState = {
      symbol: this.selectedSymbol,
      status: "ready",
      trades: Array.from({ length: 21 }, (_entry, index) => ({
        price: `188.${String(index).padStart(2, "0")}`,
        volume: BigInt((index + 1) * 100),
        timestamp: 1_700_000_000n - BigInt(index),
        tradeType: "T",
        direction: index % 3,
        tradeSession: 0,
      })),
      error: "",
    };
    this.initPriceChartView(cx);
    this.clock = null;

    // The two states the sections have to be able to be in at once, and the
    // month the picker is parked on so the grid is the same one every run.
    this.chartEndDate = "2026-08-14";
    this.chartCalendar.set_value(this.chartEndDate);
    while (this.chartCalendar.year() > 2026 || this.chartCalendar.month() > 8) {
      this.chartCalendar.prev_month();
    }
    while (this.chartCalendar.year() < 2026 || this.chartCalendar.month() < 8) {
      this.chartCalendar.next_month();
    }
    this.calendarOpen = true;
  }

  render(cx) {
    const tokens = cx.theme();
    return v_flex()
      .size_full()
      .child(this.quoteDetailsPanel(tokens))
      .child(this.chartDetailsPanel(tokens))
      .child(this.marketDetailPanel(tokens));
  }
}
