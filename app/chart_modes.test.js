import { View } from "gpui-kit";
import {
  CHART_MODES,
  chartRequestIdentity,
  mergeLiveChartQuote,
  prepareCandleSeries,
  prepareIntradaySeries,
  windowCandles,
} from "./chart_modes.js";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const unix = (iso) => BigInt(Date.parse(iso) / 1000);
const candle = (iso, price, tradeSession, marketDay, volume = 1n) => ({
  timestamp: unix(iso),
  open: String(price),
  high: String(price),
  low: String(price),
  close: String(price),
  volume,
  tradeSession,
  marketDay,
});

function runVectors() {
  check(
    chartRequestIdentity("AAPL.US", "15m", "2026-08-28") === "AAPL.US|15m|15m|2026-08-28",
    "request identity includes symbol, mode, period, and end date",
  );
  check(
    CHART_MODES.intraday.period === "1m" && CHART_MODES["1D"].period === "1D",
    "chart modes retain their source periods",
  );

  const allSessions = [
    candle("2026-08-28T20:01:00Z", 101, 3, "2026-08-29"),
    candle("2026-08-29T13:31:00Z", 102, 1, "2026-08-29"),
    candle("2026-08-29T14:31:00Z", 103, 0, "2026-08-29"),
    candle("2026-08-29T20:01:00Z", 104, 2, "2026-08-29"),
  ];
  const intraday = prepareIntradaySeries(allSessions);
  check(
    intraday.candles.map((item) => item.close).join(",") === "101,102,103,104",
    "intraday orders overnight through post-market chronologically",
  );
  check(
    intraday.candles.map((item) => item.tradeSession).join(",") === "3,1,0,2",
    "intraday retains every supplied session",
  );
  check(
    intraday.sessionBoundaries.map((item) => item.tradeSession).join(",") === "3,1,0,2",
    "intraday reports each supplied session boundary",
  );
  check(
    intraday.candles[0].marketDay === "2026-08-29" && intraday.candles[0].timestamp === allSessions[0].timestamp,
    "intraday preserves provider market-day metadata and timestamps",
  );
  check(
    intraday.candles[0].geometry.close === 101 && allSessions[0].close === "101",
    "normalization parses decimals solely into geometry without mutating source candles",
  );

  const regular = prepareCandleSeries(allSessions);
  check(
    regular.candles.length === 1 && regular.candles[0].close === "103",
    "regular OHLC modes exclude extended-hours candles",
  );
  const longWindow = Array.from({ length: 121 }, (_, index) =>
    candle(`2026-08-28T14:${String(index % 60).padStart(2, "0")}:00Z`, index + 1, 0, "2026-08-28"),
  );
  check(
    windowCandles(longWindow).length === 120 && windowCandles(longWindow)[0].close === "2",
    "candle windows retain the latest 120 bars",
  );

  const quote = (iso, lastDone, marketDay, tradeSession = 0, volume = 10n) => ({
    symbol: "AAPL.US",
    timestamp: unix(iso),
    lastDone: String(lastDone),
    marketDay,
    tradeSession,
    volume,
  });
  const oneMinute = [candle("2026-08-29T14:30:00Z", 100, 0, "2026-08-29", 4n)];
  const oneMinuteMerged = mergeLiveChartQuote("AAPL.US", "1m", oneMinute, quote("2026-08-29T14:30:45Z", 103, "2026-08-29", 0, 9n));
  check(
    oneMinuteMerged[0].open === "100" && oneMinuteMerged[0].high === "103" && oneMinuteMerged[0].low === "100" && oneMinuteMerged[0].close === "103" && oneMinuteMerged[0].volume === 9n,
    "one-minute merging updates active OHLC and volume",
  );
  check(oneMinute[0].close === "100", "live merging does not mutate cached candles");

  const normalizedLive = prepareCandleSeries([
    candle("2026-08-29T14:30:00Z", 100, 0, "2026-08-29", 4n),
  ]).candles;
  const normalizedMerged = mergeLiveChartQuote(
    "AAPL.US",
    "1m",
    normalizedLive,
    quote("2026-08-29T14:30:45Z", 103, "2026-08-29", 0, 9n),
  );
  check(
    Object.isFrozen(normalizedMerged[0].geometry) &&
      normalizedMerged[0].geometry.open === 100 &&
      normalizedMerged[0].geometry.high === 103 &&
      normalizedMerged[0].geometry.low === 100 &&
      normalizedMerged[0].geometry.close === 103,
    "merging a prepared series replaces stale frozen OHLC geometry",
  );
  const normalizedAppended = mergeLiveChartQuote(
    "AAPL.US",
    "1m",
    prepareCandleSeries([]).candles,
    quote("2026-08-29T14:31:00Z", 104, "2026-08-29", 0, 10n),
  );
  check(
    Object.isFrozen(normalizedAppended[0].geometry) && normalizedAppended[0].geometry.close === 104,
    "appended live candles carry frozen geometry",
  );
  const exactHigh = "9007199254740992.00";
  const exactHigherQuote = "9007199254740992.01";
  const precise = prepareCandleSeries([
    { ...candle("2026-08-29T14:30:00Z", exactHigh, 0, "2026-08-29"), high: exactHigh },
  ]).candles;
  const preciseMerged = mergeLiveChartQuote(
    "AAPL.US",
    "1m",
    precise,
    quote("2026-08-29T14:30:45Z", exactHigherQuote, "2026-08-29", 0),
  );
  check(
    preciseMerged[0].high === exactHigherQuote,
    "live merging compares provider decimal strings without IEEE-754 precision loss",
  );
  const exactLowerQuote = "9007199254740991.99";
  const preciseRangeMerged = mergeLiveChartQuote(
    "AAPL.US",
    "1m",
    preciseMerged,
    quote("2026-08-29T14:30:50Z", exactLowerQuote, "2026-08-29", 0),
  );
  check(
    preciseRangeMerged[0].low === exactLowerQuote,
    "live merging keeps an exact decimal low beyond IEEE-754 precision",
  );

  const fiveMinute = [candle("2026-08-29T14:30:00Z", 100, 0, "2026-08-29", 1n)];
  const fiveMinuteMerged = mergeLiveChartQuote("AAPL.US", "5m", fiveMinute, quote("2026-08-29T14:34:59Z", 96, "2026-08-29", 0, 7n));
  check(
    fiveMinuteMerged[0].high === "100" && fiveMinuteMerged[0].low === "96" && fiveMinuteMerged[0].close === "96" && fiveMinuteMerged[0].volume === 7n,
    "multi-minute merging uses the active period bucket",
  );
  check(
    mergeLiveChartQuote("AAPL.US", "5m", fiveMinuteMerged, quote("2026-08-29T14:29:59Z", 90, "2026-08-29")) === fiveMinuteMerged,
    "out-of-order pushes do not rewrite later bars",
  );

  const fifteenMinute = [candle("2026-08-29T14:30:00Z", 100, 0, "2026-08-29", 2n)];
  const fifteenMinuteMerged = mergeLiveChartQuote("AAPL.US", "15m", fifteenMinute, quote("2026-08-29T14:44:59Z", 108, "2026-08-29", 0, 12n));
  check(
    fifteenMinuteMerged[0].open === "100" && fifteenMinuteMerged[0].high === "108" && fifteenMinuteMerged[0].low === "100" && fifteenMinuteMerged[0].close === "108" && fifteenMinuteMerged[0].volume === 12n,
    "fifteen-minute merging keeps OHLC and volume in the active bucket",
  );

  const daily = [candle("2026-08-28T13:30:00Z", 100, 0, "2026-08-28", 1n)];
  const dailyMerged = mergeLiveChartQuote("AAPL.US", "1D", daily, quote("2026-08-29T13:30:00Z", 105, "2026-08-29", 0, 3n));
  check(
    dailyMerged.length === 2 && dailyMerged[1].marketDay === "2026-08-29" && dailyMerged[1].open === "105",
    "daily merging starts a new provider market day without local-clock inference",
  );
  const dailyUpdated = mergeLiveChartQuote("AAPL.US", "1D", dailyMerged, quote("2026-08-29T20:00:00Z", 102, "2026-08-29", 0, 8n));
  check(
    dailyUpdated[1].open === "105" && dailyUpdated[1].high === "105" && dailyUpdated[1].low === "102" && dailyUpdated[1].close === "102",
    "daily merging updates the active provider market-day candle",
  );
  check(
    mergeLiveChartQuote("AAPL.US", "1m", oneMinuteMerged, quote("2026-08-29T14:31:00Z", 105, "2026-08-29", 1)) === oneMinuteMerged,
    "regular OHLC live merging rejects extended-hours pushes",
  );
}

runVectors();

export default class ChartModesVectorProbe extends View {
  render() {
    return { type: "text", text: "ok" };
  }
}
