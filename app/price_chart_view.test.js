import { prepareFiveDaySeries } from "./chart.js";
import PriceChartView, { PRICE_CHART_LAYOUT } from "./price_chart_view.js";

/** @param {string} iso @param {number} close */
const candle = (iso, close) => ({
  timestamp: BigInt(Date.parse(iso) / 1000),
  close: String(close),
  open: String(close),
  high: String(close),
  low: String(close),
  volume: 1n,
  tradeSession: 0,
});

export default class PriceChartViewProbe extends PriceChartView {
  init() {
    super.init({
      symbol: "AAPL.US",
      series: prepareFiveDaySeries("AAPL.US", [
        candle("2026-03-09T13:30:00Z", 100),
        candle("2026-03-09T13:31:00Z", 101),
      ]),
      state: "ready",
      layout: PRICE_CHART_LAYOUT,
      themeRevision: 0,
    });
  }
}
