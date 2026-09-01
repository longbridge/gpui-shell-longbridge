// The application keymap, end to end: a chord the host delivers reaches the
// action the root registered, and the workspace switches page.

import { h_flex, v_flex } from "gpui-base";

import LongbridgeApp from "./main.js";
import { normalizeOrders } from "./orders.js";

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

const SECOND_QUOTE = Object.freeze({
  ...QUOTE,
  symbol: "MSFT.US",
  code: "MSFT",
  name: "Microsoft Corp.",
  last: "420.00",
  sequence: 8n,
});

export default class KeymapUiProbe extends LongbridgeApp {
  init(_props, cx) {
    // The status bar is off by default in the application -- the rail and the
    // window readout are for learning it and for reading a bug report, not for
    // watching a market. This probe is about exactly those two, so it turns
    // them on rather than asserting against a surface nobody asked for.
    this.statusBarVisible = true;
    this.initInteractionState();
    this.initKeyboard(cx);
    this.initChartCalendar(cx);
    this.instruments = [
      { symbol: QUOTE.symbol, code: QUOTE.code, name: QUOTE.name, market: QUOTE.market },
      {
        symbol: SECOND_QUOTE.symbol,
        code: SECOND_QUOTE.code,
        name: SECOND_QUOTE.name,
        market: SECOND_QUOTE.market,
      },
    ];
    this.quotes = [QUOTE, SECOND_QUOTE];
    this.portfolioQuotes = [];
    this.selectedSymbol = QUOTE.symbol;
    this.page = "watchlist";
    this.hasStoredTokens = true;
    this.status = { state: "connected" };
    this.authorization = null;
    this.account = null;
    this.fxRates = new Map([["USD", 1]]);
    this.holdings = [
      {
        symbol: QUOTE.symbol,
        name: QUOTE.name,
        quantity: "10",
        available: "10",
        costPrice: "180",
        currency: "USD",
      },
      {
        symbol: SECOND_QUOTE.symbol,
        name: SECOND_QUOTE.name,
        quantity: "20",
        available: "20",
        costPrice: "400",
        currency: "USD",
      },
    ];
    this.initOrdersState();
    this.ordersState = {
      status: "ready",
      loaded: true,
      today: normalizeOrders({
        data: {
          orders: [
            {
              order_id: "884955210000",
              status: "FilledStatus",
              stock_name: "Apple Inc.",
              quantity: "10",
              executed_quantity: "10",
              price: "188.500",
              executed_price: "188.480",
              submitted_at: "1700000000",
              side: "Buy",
              symbol: "AAPL.US",
              order_type: "LO",
              currency: "USD",
            },
          ],
        },
      }),
      history: [],
      error: "",
    };
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

  /** Nor for orders, which the page would otherwise read on the way in. */
  loadOrders() {}

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

  /**
   * The two panes, drawn inline rather than in the dock.
   *
   * What this probe is for is the keymap and the actions the root registers,
   * and both of those are answered by what the panes *contain* — the calendar
   * the picker opens, the diagnostics readout, the row a right press copies
   * from. In the application those live in dock panels, whose descriptions
   * belong to the panels rather than to this view; drawing them here is what
   * keeps the assertions able to see them, and changes nothing about the
   * dispatch under test.
   *
   * Creating no dock is the other half: `super.init` is not called, so nothing
   * has mounted the panes anywhere else.
   *
   * @param {import("gpui-base").Theme} tokens
   */
  watchlistPage(tokens) {
    // `h_flex` centres its children, so each pane is told to fill the row's
    // height; a dock does that for itself, which is one reason the application
    // no longer has this code.
    return h_flex()
      .flex_1()
      .min_h(0)
      .gap(tokens.spacing.sm)
      .child(v_flex().w(620).h_full().min_w(0).child(this.watchlist(tokens).size_full()))
      .child(v_flex().flex_1().h_full().min_w(0).child(this.stockDetail(tokens).size_full()));
  }

  render(cx) {
    return super.render(cx);
  }
}
