// The Holdings panel with more positions than one page holds, so the pager
// base lays out -- `pagination_items` -- has gaps to collapse.

import { v_flex } from "gpui-base";
import LongbridgeApp from "./main.js";

/** @param {number} index */
function holding(index) {
  const code = `H${String(index).padStart(3, "0")}`;
  return {
    symbol: `${code}.US`,
    name: `Holding ${index}`,
    quantity: "10",
    available: "10",
    costPrice: "100",
    currency: "USD",
  };
}

/** @param {number} index */
function priced(index) {
  const code = `H${String(index).padStart(3, "0")}`;
  return {
    symbol: `${code}.US`,
    code,
    name: `Holding ${index}`,
    market: "US",
    currency: "USD",
    last: `${100 + index}`,
    prevClose: `${99 + index}`,
    change: "+1.00",
    changePercent: "+1.00%",
    receivedAt: 1_700_000_001_000,
    updatedAt: 1_700_000_000_000,
  };
}

export default class HoldingsPagerProbe extends LongbridgeApp {
  init(_props, cx) {
    this.initInteractionState();
    this.initChartCalendar(cx);
    this.account = {
      net_assets: "25000.00",
      total_cash: "5000.00",
      buy_power: "8000.00",
      currency: "USD",
      risk_level: "1",
    };
    this.fxRates = new Map([["USD", 1]]);
    // Eighty positions at eight to a page is ten pages: enough for the layout
    // to keep the first, the last and a window around the current one, and to
    // collapse what is left into two gaps.
    this.holdings = Array.from({ length: 80 }, (_, index) => holding(index));
    this.portfolioQuotes = Array.from({ length: 80 }, (_, index) => priced(index));
    this.quotes = [];
    this.page = "portfolio";
    this.holdingsPage = 5;
    this.hasStoredTokens = true;
    this.status = { state: "connected" };
    this.authorization = null;
    this.error = "";
    this.streamError = "";
    this.stream = null;
    this.candleCache = new Map();
    this.chartState = { symbol: null, state: "idle" };
    this.chartGeneration = 0;
    this.chartThemeRevision = 0;
    this.initPriceChartView(cx);
    this.clock = null;
  }

  render(cx) {
    return v_flex().size_full().child(this.portfolioPage(cx.theme()));
  }
}
