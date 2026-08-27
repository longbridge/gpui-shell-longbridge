import { Button, h_flex, v_flex } from "gpui-base";

import LongbridgeApp from "./main.js";

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

export default class RetainedPriceChartProbe extends LongbridgeApp {
  init(_props, cx) {
    this.selectedSymbol = "AAPL.US";
    this.candleCache = new Map([
      [
        this.selectedSymbol,
        [candle("2026-03-09T13:30:00Z", 100), candle("2026-03-09T13:31:00Z", 101)],
      ],
    ]);
    this.chartState = { symbol: this.selectedSymbol, state: "ready" };
    this.chartGeneration = 0;
    this.chartThemeRevision = 0;
    this.initPriceChartView(cx);
    this.parentRenders = 0;
  }

  /** @param {"loading" | "error" | "ready"} state */
  publishChartState(state) {
    this.chartState = { symbol: this.selectedSymbol, state };
    this.syncPriceChartView();
  }

  render() {
    this.parentRenders += 1;
    return v_flex()
      .w(480)
      .h(218)
      .child(
        h_flex()
          .h(40)
          .child(
            Button.new("chart-loading")
              .w(160)
              .h(40)
              .on_click(() => this.publishChartState("loading"))
              .child(`Loading · Parent renders: ${this.parentRenders}`),
          )
          .child(
            Button.new("chart-error")
              .w(160)
              .h(40)
              .on_click(() => this.publishChartState("error"))
              .child("Error"),
          )
          .child(
            Button.new("chart-ready")
              .w(160)
              .h(40)
              .on_click(() => this.publishChartState("ready"))
              .child("Ready"),
          ),
      )
      .child(this.priceChart);
  }
}
