import LongbridgeApp from "./main.js";

export default class PortfolioUiProbe extends LongbridgeApp {
  init() {
    this.account = {
      net_assets: "25000.00",
      total_cash: "5000.00",
      buy_power: "8000.00",
      currency: "USD",
      risk_level: "1",
    };
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
    this.clock = null;
  }

  render(cx) {
    return this.portfolioPage(cx.theme());
  }
}
