import { prepareFiveDaySeries } from "./chart.js";
import { prepareCandleSeries, prepareIntradaySeries } from "./chart_modes.js";
import PriceChartView, {
  PRICE_CHART_LAYOUT,
  compactIntradaySeriesForView,
  layoutIntradayForView,
} from "./price_chart_view.js";
import { Button, h_flex, v_flex } from "gpui-base";

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

const SESSION_CANDLES = Object.freeze([
  { ...candle("2026-03-09T08:00:00Z", 99), tradeSession: 3, marketDay: "2026-03-09" },
  { ...candle("2026-03-09T12:00:00Z", 100), tradeSession: 1, marketDay: "2026-03-09" },
  { ...candle("2026-03-09T13:30:00Z", 101), tradeSession: 0, marketDay: "2026-03-09" },
  { ...candle("2026-03-09T20:00:00Z", 102), tradeSession: 2, marketDay: "2026-03-09" },
]);

const CANDLE_SERIES = Object.freeze([
  {
    timestamp: BigInt(Date.parse("2026-03-09T13:30:00Z") / 1000),
    marketDay: "2026-03-09",
    open: "100",
    high: "104",
    low: "99",
    close: "103",
    volume: 42n,
    tradeSession: 0,
  },
  {
    timestamp: BigInt(Date.parse("2026-03-09T13:31:00Z") / 1000),
    open: "103",
    high: "105",
    low: "101",
    close: "102",
    volume: 64n,
    tradeSession: 0,
  },
]);

const denseIntraday = Array.from({ length: 1_200 }, (_entry, index) => ({
  ...candle(
    new Date(Date.parse("2026-03-09T08:00:00Z") + index * 60_000).toISOString(),
    100 + (index % 17),
  ),
  tradeSession: index < 300 ? 3 : index < 600 ? 1 : index < 990 ? 0 : 2,
  marketDay: "2026-03-09",
}));

const compactIntraday = layoutIntradayForView(
  { ...prepareIntradaySeries(denseIntraday), previousClose: "99" },
  PRICE_CHART_LAYOUT,
);
if (
  compactIntraday.points.length > 240 ||
  compactIntraday.sessionSegments.some((segment) => segment.points.length === 0) ||
  !compactIntraday.points.some((point) => point.close === 116) ||
  !compactIntraday.points.some((point) => point.close === 100) ||
  ![0, 300, 600, 990].every((index) =>
    compactIntraday.points.some((point) => point.timestamp === denseIntraday[index].timestamp),
  )
) {
  throw new Error(
    "intraday paint geometry caps point cost without hiding extrema or session starts",
  );
}

const retainedIntraday = compactIntradaySeriesForView(
  { ...prepareIntradaySeries(denseIntraday), previousClose: "99" },
  PRICE_CHART_LAYOUT,
);
if (
  retainedIntraday.candles.length > 240 ||
  retainedIntraday.sessionBoundaries.length !== 4 ||
  retainedIntraday.previousClose !== "99"
) {
  throw new Error("intraday props are compact before crossing the retained-view bridge");
}

function propsFor(mode) {
  const fiveDay = prepareFiveDaySeries("AAPL.US", SESSION_CANDLES);
  const chartSeries =
    mode === "intraday"
      ? { ...prepareIntradaySeries(SESSION_CANDLES), previousClose: "98.500" }
      : mode === "5D"
        ? fiveDay
        : prepareCandleSeries(CANDLE_SERIES);
  return {
    symbol: "AAPL.US",
    mode,
    chartSeries,
    state: "ready",
    layout: PRICE_CHART_LAYOUT,
    themeRevision: 0,
  };
}

export default class PriceChartViewProbe extends PriceChartView {
  init() {
    this.mode = "5D";
    super.init(propsFor(this.mode));
  }

  selectMode(mode, cx) {
    this.mode = mode;
    this.applyProps(propsFor(mode));
    cx.notify();
  }

  render(cx) {
    return v_flex()
      .w(480)
      .gap(cx.theme().spacing.xs)
      .child(
        h_flex()
          .h(28)
          .children(
            ["intraday", "5D", "1m"].map((mode) =>
              Button.new(`probe-chart-mode-${mode}`)
                .flex_1()
                .selected(mode === this.mode)
                .on_click((_event, context) => this.selectMode(mode, context))
                .child(mode === "intraday" ? "Intraday" : mode),
            ),
          ),
      )
      .child(super.render(cx));
  }
}
