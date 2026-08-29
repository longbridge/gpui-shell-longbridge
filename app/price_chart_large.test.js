import { Button, v_flex } from "gpui-base";
import LongbridgeApp from "./main.js";

const candle = (index) => ({
  timestamp: 1_777_642_200n + BigInt(index * 60),
  marketDay: "2026-05-01",
  open: String(100 + (index % 7)),
  high: String(102 + (index % 7)),
  low: String(99 + (index % 7)),
  close: String(101 + (index % 7)),
  volume: BigInt(index + 1),
  tradeSession: 0,
});

export default class LargePriceChartProbe extends LongbridgeApp {
  init(_props, cx) {
    this.selectedSymbol = "AAPL.US";
    this.candleCache = new Map([[this.selectedSymbol, [candle(0), candle(1)]]]);
    this.chartState = { symbol: this.selectedSymbol, state: "ready" };
    this.chartGeneration = 0;
    this.chartThemeRevision = 0;
    this.initChartModeState();
    this.initPriceChartView(cx);
    this.result = "idle";
  }

  publishLargeSeries(cx) {
    this.candleCache = new Map([
      [this.selectedSymbol, Array.from({ length: 12_000 }, (_entry, index) => candle(index))],
    ]);
    try {
      this.syncPriceChartView();
      this.result = "published";
    } catch (error) {
      this.result = String(error);
    }
    cx.notify();
  }

  render() {
    return v_flex()
      .w(520)
      .h(240)
      .child(
        Button.new("publish-large-chart")
          .h(40)
          .on_click((_event, cx) => this.publishLargeSeries(cx))
          .child(`Publish 12,000 candles · ${this.result}`),
      )
      .child(this.priceChart);
  }
}
