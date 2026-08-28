import { Button, v_flex } from "gpui-base";
import { holdContext } from "./context.js";
import LongbridgeApp from "./main.js";

/** @param {string} symbol @param {string} last @param {bigint} sequence */
function quote(symbol, last, sequence) {
  const [code, market] = symbol.split(".");
  return {
    symbol,
    code,
    name: code,
    market,
    currency: "USD",
    last,
    prevClose: "99",
    open: "99",
    high: last,
    low: "99",
    change: "+1",
    changePercent: "+1%",
    volume: 1n,
    turnover: "100",
    tradeStatus: 0,
    tradeSession: 0,
    sequence,
    updatedAt: 1_700_000_000_000,
    receivedAt: 1_700_000_000_000,
  };
}

export default class PriceChartUpdateProbe extends LongbridgeApp {
  init(_props, cx) {
    holdContext(cx);
    this.selectedSymbol = "AAPL.US";
    this.quotes = [quote("AAPL.US", "100", 1n), quote("MSFT.US", "200", 1n)];
    this.portfolioQuotes = [];
    this.lastTick = 1_700_000_001_000;
    this.quotePulse = 1;
    // The application buffers pushes and coalesces the repaint, so a probe that
    // builds its state by hand has to carry the same fields or the first quote
    // throws before anything is drawn.
    this.pendingQuotes = [];
    this.dirtyPanes = 0;
    this.repaint = null;
    this.chartDirty = false;
    this.candleCache = new Map([
      [
        this.selectedSymbol,
        [
          { timestamp: 1_699_920_000n, close: "98", tradeSession: 0 },
          { timestamp: 1_700_006_400n, close: "100", tradeSession: 0 },
        ],
      ],
    ]);
    this.chartState = { symbol: this.selectedSymbol, state: "ready" };
    this.chartGeneration = 0;
    this.chartThemeRevision = 0;
    this.initPriceChartView(cx);
    this.renders = 0;
  }

  render() {
    this.renders += 1;
    return v_flex()
      .w(500)
      .h(220)
      .child(
        Button.new("unrelated-quote")
          .w(500)
          .h(40)
          .on_click((_event, cx) => this.receiveQuote(quote("MSFT.US", "201", 2n), cx))
          .child(`Root renders: ${this.renders}`),
      )
      .child(this.priceChart);
  }
}
