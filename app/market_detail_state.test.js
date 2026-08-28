// Selected-symbol detail state must stay independent from the retained chart.

import LongbridgeApp from "./main.js";
import { holdContext } from "./context.js";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function depth(symbol, price) {
  return {
    symbol,
    asks: [{ position: 1, price, volume: 2n }],
    bids: [{ position: 1, price: "99.00", volume: 3n }],
  };
}

function trades(symbol, price) {
  return {
    symbol,
    trades: [
      {
        price,
        volume: 1n,
        timestamp: 2n,
        tradeType: "T",
        direction: 1,
        tradeSession: 0,
      },
    ],
  };
}

export default class MarketDetailStateProbe extends LongbridgeApp {
  init(_props, cx) {
    holdContext(cx);
    this.selectedSymbol = null;
    this.streamGeneration = 0;
    this.chartGeneration = 0;
    this.chartState = { symbol: "CHART.US", state: "ready" };
    this.candleCache = new Map();
    this.priceChart = null;
    this.publishedPriceChartProps = Object.freeze({ symbol: "CHART.US" });
    this.instruments = [];
    this.quotes = [];
    this.portfolioQuotes = [];
    this.holdings = [];
    this.fxRates = new Map();
    this.status = { state: "connected" };
    this.streamError = "";
    this.hasStoredTokens = true;
    this.authorization = null;
    this.account = null;
    this.connectedToken = "test";
    this.detailMarketGeneration = 0;
    this.depthState = { symbol: null, status: "idle", asks: [], bids: [], error: "" };
    this.tradesState = { symbol: null, status: "idle", trades: [], error: "" };
    this.stream = {
      selectDetailSymbol: () => Promise.resolve(),
      stop: async () => {},
    };

    const chartProps = this.publishedPriceChartProps;
    this.selectDetailMarket("A.US", cx);
    this.selectDetailMarket("B.US", cx);
    check(
      this.depthState.symbol === "B.US" && this.depthState.status === "loading" && this.depthState.asks.length === 0,
      "selecting B immediately clears A depth while it loads",
    );
    check(
      this.tradesState.symbol === "B.US" && this.tradesState.status === "loading" && this.tradesState.trades.length === 0,
      "selecting B immediately clears A trades while it loads",
    );

    // A's delayed snapshots arrive only after B became the selection.
    this.receiveDepth(depth("A.US", "101.00"), cx);
    this.receiveTrades(trades("A.US", "101.25"), cx);
    check(
      this.depthState.asks.length === 0 && this.tradesState.trades.length === 0,
      "a stale detail snapshot cannot publish under B",
    );

    this.receiveDepth(depth("B.US", "102.00"), cx);
    this.receiveTrades(trades("B.US", "102.25"), cx);
    check(
      this.depthState.status === "ready" && this.depthState.asks[0].price === "102.00",
      "the selected depth snapshot publishes normally",
    );
    check(
      this.tradesState.status === "ready" && this.tradesState.trades[0].price === "102.25",
      "the selected trades snapshot publishes normally",
    );
    check(
      this.chartState.symbol === "CHART.US" && this.publishedPriceChartProps === chartProps,
      "detail-only updates do not publish new retained-chart props",
    );

    this.signOut(cx);
    check(
      this.depthState.symbol === null && this.depthState.status === "idle" && this.depthState.asks.length === 0,
      "sign-out clears the depth state",
    );
    check(
      this.tradesState.symbol === null && this.tradesState.status === "idle" && this.tradesState.trades.length === 0,
      "sign-out clears the trades state",
    );
  }

  render() {
    return "ok";
  }
}
