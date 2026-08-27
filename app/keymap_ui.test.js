// The application keymap, end to end: a chord the host delivers reaches the
// action the root registered, and the workspace switches page.

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

export default class KeymapUiProbe extends LongbridgeApp {
  init(_props, cx) {
    this.initInteractionState();
    this.initKeyboard(cx);
    this.initChartCalendar(cx);
    this.instruments = [
      { symbol: QUOTE.symbol, code: QUOTE.code, name: QUOTE.name, market: QUOTE.market },
    ];
    this.quotes = [QUOTE];
    this.portfolioQuotes = [];
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
    this.chartState = { symbol: QUOTE.symbol, state: "ready" };
    this.chartGeneration = 0;
    this.chartThemeRevision = 0;
    this.initPriceChartView(cx);
    this.clock = null;
    // The picker is up, so `escape` has something to put away, and the
    // diagnostics popover is up so its readings are in the tree.
    this.calendarOpen = true;
    this.diagnosticsOpen = true;
  }

  /** The probe reaches no network: what is under test is the dispatch. */
  loadPortfolio() {}

  /** Neither does reconnecting; the status is what says the action arrived. */
  resume(cx) {
    this.status = { state: "restoring_token" };
    cx.notify();
  }

  /**
   * `ctrl-alt-d` stands in for the session menu's Reconnect item.
   *
   * It is bound to no chord, so nothing about the keymap can carry it: what
   * reaches the action is `window.dispatch_action`, which is exactly what the
   * menu item calls and exactly what is under test.
   */
  observeKey(event, down, cx) {
    if (down && event.keystroke === "ctrl-alt-d") {
      window.dispatch_action("workspace::reconnect");
    }
    super.observeKey(event, down, cx);
  }

  render(cx) {
    return super.render(cx);
  }
}
