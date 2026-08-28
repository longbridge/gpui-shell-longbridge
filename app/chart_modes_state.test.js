// Chart-mode application state owns request identity, cache, and generation.

import { View } from "gpui";
import { holdContext } from "./context.js";
import { chartRequestIdentity } from "./chart_modes.js";
import { PERIOD, TRADE_SESSION } from "./protocol.js";
import LongbridgeApp from "./main.js";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const candle = (timestamp, close = "100") => ({
  timestamp: BigInt(timestamp),
  open: close,
  high: close,
  low: close,
  close,
  volume: 1n,
  tradeSession: 0,
  marketDay: "2026-08-29",
});

export default class ChartModeStateProbe extends LongbridgeApp {
  init(_props, cx) {
    holdContext(cx);
    this.selectedSymbol = "AAPL.US";
    this.chartEndDate = null;
    this.chartGeneration = 0;
    this.chartThemeRevision = 0;
    this.chartState = { symbol: this.selectedSymbol, state: "idle" };
    this.candleCache = new Map();
    this.stream = null;
    this.pendingQuotes = [];
    this.dirtyPanes = 0;
    this.repaint = null;
    this.chartDirty = false;
    this.quotePulse = 1;
    this.initChartModeState();

    check(this.chartMode === "5D", "chart mode defaults to 5D without reading persisted storage");
    this.chartMode = "1m";
    const normalizedIdentity = this.currentChartIdentity();
    const normalizedGeneration = ++this.chartGeneration;
    check(
      this.publishChartResponse("AAPL.US", normalizedIdentity, normalizedGeneration, [
        candle(1_699_999_940),
      ]),
      "the current response publishes",
    );
    check(
      this.chartCache.get(normalizedIdentity)[0].geometry &&
        Object.isFrozen(this.chartCache.get(normalizedIdentity)[0].geometry),
      "the session cache keeps normalized chart candles",
    );
    this.chartMode = "5D";
    const defaultIdentity = chartRequestIdentity("AAPL.US", "5D", "latest");
    const minuteIdentity = chartRequestIdentity("AAPL.US", "1m", "latest");
    this.cacheChartSeries(defaultIdentity, [candle(1_700_000_000)]);
    this.cacheChartSeries(minuteIdentity, [candle(1_700_000_060)]);

    const intradayNow = this.chartRequestFor("AAPL.US", "intraday", "latest");
    check(
      intradayNow.kind === "intraday" && intradayNow.params.tradeSession === TRADE_SESSION.ALL,
      "only the current Intraday boundary uses command-18 full-session data",
    );
    const intradayHistory = this.chartRequestFor("AAPL.US", "intraday", "2026-08-28");
    check(
      intradayHistory.kind === "candlesticks" &&
        intradayHistory.params.period === PERIOD.ONE_MINUTE &&
        intradayHistory.params.startDate === "20260828" &&
        intradayHistory.params.endDate === "20260828" &&
        intradayHistory.params.tradeSession === TRADE_SESSION.ALL,
      "a selected historical Intraday day uses a date-bounded full-session minute request",
    );
    for (const [mode, period] of [
      ["5D", PERIOD.ONE_MINUTE],
      ["1m", PERIOD.ONE_MINUTE],
      ["5m", PERIOD.FIVE_MINUTE],
      ["15m", PERIOD.FIFTEEN_MINUTE],
      ["1D", PERIOD.DAY],
    ]) {
      const request = this.chartRequestFor("AAPL.US", mode, "2026-08-28");
      check(
        request.kind === "candlesticks" &&
          request.params.period === period &&
          request.params.tradeSession === TRADE_SESSION.NORMAL,
        `${mode} chooses its regular-session candlestick period`,
      );
    }

    this.chartMode = "1m";
    this.chartEndDate = null;
    this.chartCalendar = { value: () => null, set_value: () => {} };
    const pickedIdentity = chartRequestIdentity("AAPL.US", "1m", "2026-08-28");
    this.cacheChartSeries(pickedIdentity, [candle(1_700_000_000)]);
    this.setChartEnd("2026-08-28", cx);
    check(
      this.chartCache.has(pickedIdentity),
      "choosing a date preserves a completed cache entry for that new identity",
    );
    this.chartEndDate = null;

    this.chartMode = "1D";
    this.chartEndDate = "2026-08-29";
    const dailyIdentity = this.currentChartIdentity();
    const dailyGeneration = ++this.chartGeneration;
    check(
      this.publishChartResponse(
        "AAPL.US",
        dailyIdentity,
        dailyGeneration,
        [{ ...candle(1_700_000_000), marketDay: undefined }],
        "2026-08-29",
      ),
      "a selected-day daily response publishes",
    );
    check(
      this.chartCache.get(dailyIdentity)[0].marketDay === "2026-08-29",
      "a dated response retains its authoritative request market day",
    );
    this.receiveQuote(
      {
        symbol: "AAPL.US",
        timestamp: 1_700_000_030n,
        lastDone: "104",
        volume: 11n,
        tradeSession: 0,
        marketDay: "2026-08-29",
      },
      cx,
    );
    const dailyMerged = this.chartCache.get(dailyIdentity)[0];
    check(
      dailyMerged.close === "104" && dailyMerged.high === "104" && dailyMerged.volume === 11n,
      "a provider-labelled daily Quote updates the active daily OHLCV bucket",
    );
    this.chartEndDate = null;
    this.chartMode = "5D";

    let requests = 0;
    this.stream = {
      queryCandlesticks: async () => {
        requests += 1;
        return { candlesticks: [] };
      },
      queryIntraday: async () => {
        requests += 1;
        return { lines: [] };
      },
    };
    this.loadSelectedChart(cx);
    this.setChartMode("1m", cx);
    check(this.chartMode === "1m", "mode changes stay in application state");
    check(this.chartState.state === "ready", "a mode-specific cache hit is immediately ready");
    check(requests === 0, "a cache hit does not issue another chart request");

    const activeIdentity = this.currentChartIdentity();
    const activeGeneration = this.chartGeneration;
    this.setChartMode("5m", cx);
    const stalePublished = this.publishChartResponse("AAPL.US", activeIdentity, activeGeneration, [
      candle(1_700_000_120, "101"),
    ]);
    check(!stalePublished, "a superseded mode response never publishes");
    check(
      this.chartCache.get(activeIdentity)[0].close === "100",
      "a stale response cannot overwrite the previous mode cache entry",
    );

    this.setChartMode("1m", cx);
    const dateIdentity = this.currentChartIdentity();
    const dateGeneration = this.chartGeneration;
    this.chartEndDate = "2026-08-28";
    this.loadSelectedChart(cx);
    check(
      !this.publishChartResponse("AAPL.US", dateIdentity, dateGeneration, [
        candle(1_700_000_180, "105"),
      ]),
      "a response from the previous end date never publishes",
    );
    this.chartEndDate = null;
    this.loadSelectedChart(cx);
    const symbolIdentity = this.currentChartIdentity();
    const symbolGeneration = this.chartGeneration;
    this.selectedSymbol = "MSFT.US";
    this.loadSelectedChart(cx);
    check(
      !this.publishChartResponse("AAPL.US", symbolIdentity, symbolGeneration, [
        candle(1_700_000_240, "106"),
      ]),
      "a response from the previous symbol never publishes",
    );
    this.selectedSymbol = "AAPL.US";
    this.loadSelectedChart(cx);
    const beforeLive = this.chartCache.get(minuteIdentity);
    this.receiveQuote(
      {
        symbol: "AAPL.US",
        timestamp: 1_700_000_110n,
        lastDone: "103",
        volume: 9n,
        tradeSession: 0,
        marketDay: "2026-08-29",
      },
      cx,
    );
    const afterLive = this.chartCache.get(minuteIdentity);
    check(
      afterLive !== beforeLive && afterLive.at(-1).close === "103",
      "live quote merges only into active series",
    );
    this.setChartMode("5D", cx);
    check(
      this.chartCache.get(minuteIdentity) === afterLive,
      "changing modes never lets a quote update a background cached series",
    );

    this.selectedSymbol = "NVDA.US";
    this.setChartMode("1m", cx);
    const uncachedIdentity = this.currentChartIdentity();
    this.receiveQuote(
      {
        symbol: "NVDA.US",
        timestamp: 1_700_000_300n,
        lastDone: "120",
        volume: 1n,
        tradeSession: 0,
        marketDay: "2026-08-29",
      },
      cx,
    );
    check(
      !this.chartCache.has(uncachedIdentity),
      "a live push cannot create an uncached loading series",
    );

    this.chartCache = new Map();
    for (let index = 0; index <= 16; index += 1) {
      this.cacheChartSeries(`cache-${index}`, [candle(1_700_000_000 + index)]);
    }
    check(
      this.chartCache.size === 16 && !this.chartCache.has("cache-0") && this.chartCache.has("cache-16"),
      "the bounded session cache evicts its least-recently-used identity",
    );
  }

  render() {
    return "ok";
  }
}
