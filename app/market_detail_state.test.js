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
    this.pendingQuotes = [];
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
    const bGeneration = this.detailMarketGeneration;
    check(
      this.depthState.symbol === "B.US" &&
        this.depthState.status === "loading" &&
        this.depthState.asks.length === 0,
      "selecting B immediately clears A depth while it loads",
    );
    check(
      this.tradesState.symbol === "B.US" &&
        this.tradesState.status === "loading" &&
        this.tradesState.trades.length === 0,
      "selecting B immediately clears A trades while it loads",
    );

    // A's delayed snapshots arrive only after B became the selection.
    this.receiveDepth(depth("A.US", "101.00"), cx, bGeneration);
    this.receiveTrades(trades("A.US", "101.25"), cx, bGeneration);
    check(
      this.depthState.asks.length === 0 && this.tradesState.trades.length === 0,
      "a stale detail snapshot cannot publish under B",
    );

    // Book/tape pushes coalesce behind the independent Market Detail panel.
    this.dirtyPanes = 0;
    const notified = [];
    let scheduled = null;
    const metricCx = {
      notify: (target) => notified.push(target ?? "root"),
      timer: { after: (_delay, callback) => ((scheduled = callback), {}) },
    };
    let retainedChartPublishes = 0;
    const marketRevision = this.paneRevisions?.market ?? 0;
    this.priceChart = {
      set_props: () => (retainedChartPublishes += 1),
      release: () => {},
    };

    this.receiveDepth(depth("B.US", "102.00"), metricCx, bGeneration);
    this.receiveTrades(trades("B.US", "102.25"), metricCx, bGeneration);
    check(typeof scheduled === "function", "market updates schedule one coalesced publication");
    scheduled(metricCx);
    check(
      this.depthState.status === "ready" && this.depthState.asks[0].price === "102.00",
      "the selected depth snapshot publishes normally",
    );
    this.receiveDepth({ symbol: "B.US", asks: [], bids: [] }, metricCx, bGeneration);
    check(
      this.depthState.asks[0].price === "102.00" && this.depthState.bids[0].price === "99.00",
      "an empty depth push keeps the selected symbol's last valid order book",
    );
    check(
      this.tradesState.status === "ready" && this.tradesState.trades[0].price === "102.25",
      "the selected trades snapshot publishes normally",
    );
    check(
      this.chartState.symbol === "CHART.US" && this.publishedPriceChartProps === chartProps,
      "detail-only updates do not publish new retained-chart props",
    );
    check(
      notified.length === 0 && this.paneRevisions.market === marketRevision + 1,
      "depth and trades publish one Market Detail revision without repainting the root",
    );
    check(
      retainedChartPublishes === 0,
      "depth/trade pushes cannot rebuild the retained chart child",
    );

    // Returning to A is a new selection epoch. A first-A response may arrive
    // after A → B → A, but it must not be mistaken for the final A request.
    this.selectDetailMarket("A.US", cx);
    const firstAGeneration = this.detailMarketGeneration;
    this.selectDetailMarket("B.US", cx);
    this.selectDetailMarket("A.US", cx);
    const finalAGeneration = this.detailMarketGeneration;
    this.receiveDepth(depth("A.US", "stale-first-A"), cx, firstAGeneration);
    this.receiveTrades(trades("A.US", "stale-first-A"), cx, firstAGeneration);
    check(
      this.depthState.status === "loading" && this.tradesState.status === "loading",
      "a delayed first-A snapshot or push cannot publish during the final A epoch",
    );
    this.receiveDepth(depth("A.US", "103.00"), cx, finalAGeneration);
    this.receiveTrades(trades("A.US", "103.25"), cx, finalAGeneration);
    check(
      this.depthState.asks[0].price === "103.00" && this.tradesState.trades[0].price === "103.25",
      "only the final A epoch may publish after A → B → A",
    );

    this.signOut(cx);
    check(
      this.depthState.symbol === null &&
        this.depthState.status === "idle" &&
        this.depthState.asks.length === 0 &&
        this.depthCache.size === 0,
      "sign-out clears the depth state and the prior authenticated session's cache",
    );
    check(
      this.tradesState.symbol === null &&
        this.tradesState.status === "idle" &&
        this.tradesState.trades.length === 0,
      "sign-out clears the trades state",
    );
  }

  render() {
    return "ok";
  }
}
