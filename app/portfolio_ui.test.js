import LongbridgeApp from "./main.js";
import { holdContext } from "./context.js";

export default class PortfolioUiProbe extends LongbridgeApp {
  init(_props, cx) {
    holdContext(cx);
    // A probe replaces init wholesale, so it owes the view the state a render
    // reaches for unconditionally.
    this.initInteractionState();
    this.account = {
      net_assets: "25000.00",
      total_cash: "5000.00",
      buy_power: "8000.00",
      currency: "USD",
      risk_level: "1",
    };
    this.fxRates = new Map([["USD", 1]]);
    this.holdings = [
      {
        symbol: "AAPL.US",
        name: "Apple",
        quantity: "10",
        available: "8",
        costPrice: "180",
        currency: "USD",
      },
    ];
    this.quotes = [];
    this.portfolioQuotes = [
      {
        symbol: "AAPL.US",
        currency: "USD",
        last: "188",
        prevClose: "185",
      },
    ];
    this.page = "portfolio";
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
    return this.portfolioPage(cx.theme());
  }
}
