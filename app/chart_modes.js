const PERIOD_SECONDS = Object.freeze({
  "1m": 60,
  "5m": 5 * 60,
  "15m": 15 * 60,
});

const chartModes = {
  intraday: { id: "intraday", period: "1m", regularOnly: false },
  "5D": { id: "5D", period: "1m", regularOnly: true },
  "1m": { id: "1m", period: "1m", regularOnly: true },
  "5m": { id: "5m", period: "5m", regularOnly: true },
  "15m": { id: "15m", period: "15m", regularOnly: true },
  "1D": { id: "1D", period: "1D", regularOnly: true },
};

/** The selectable chart modes and the source period each needs. */
export const CHART_MODES = Object.freeze(
  Object.fromEntries(Object.entries(chartModes).map(([key, value]) => [key, Object.freeze(value)])),
);

function modeFor(mode) {
  return typeof mode === "string" ? CHART_MODES[mode] ?? null : null;
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampSeconds(value) {
  const parsed = typeof value === "bigint" ? Number(value) : value;
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function marketDay(value) {
  return typeof value?.marketDay === "string"
    ? value.marketDay
    : typeof value?.tradingDate === "string"
      ? value.tradingDate
      : null;
}

function normalizeCandle(candle) {
  if (!candle || typeof candle !== "object" || timestampSeconds(candle.timestamp) === null) return null;
  const open = numeric(candle.open);
  const high = numeric(candle.high);
  const low = numeric(candle.low);
  const close = numeric(candle.close);
  if (open === null || high === null || low === null || close === null) return null;
  return Object.freeze({
    ...candle,
    geometry: Object.freeze({ open, high, low, close }),
  });
}

function normalizeCandles(candles, predicate) {
  if (!Array.isArray(candles)) return [];
  return candles
    .map((candle, index) => ({ candle: normalizeCandle(candle), index }))
    .filter(({ candle }) => candle !== null && predicate(candle))
    .sort(
      (left, right) =>
        timestampSeconds(left.candle.timestamp) - timestampSeconds(right.candle.timestamp) ||
        left.index - right.index,
    )
    .map(({ candle }) => candle);
}

/** A cache identity that changes with every chart request input. */
export function chartRequestIdentity(symbol, mode, endDate) {
  const selected = modeFor(mode);
  return selected === null ? null : `${symbol}|${selected.id}|${selected.period}|${endDate}`;
}

/** Sorts all provider-labelled sessions without inferring a market day from local time. */
export function prepareIntradaySeries(candles) {
  const prepared = normalizeCandles(candles, () => true);
  const sessionBoundaries = [];
  let previousSession = Symbol("first session");
  for (let index = 0; index < prepared.length; index += 1) {
    const candle = prepared[index];
    if (candle.tradeSession !== previousSession) {
      sessionBoundaries.push(
        Object.freeze({
          index,
          timestamp: candle.timestamp,
          tradeSession: candle.tradeSession,
          marketDay: marketDay(candle),
        }),
      );
      previousSession = candle.tradeSession;
    }
  }
  return Object.freeze({
    candles: Object.freeze(prepared),
    sessionBoundaries: Object.freeze(sessionBoundaries),
  });
}

/** Sorts regular-session OHLC candles and supplies numbers only for geometry. */
export function prepareCandleSeries(candles) {
  return Object.freeze({
    candles: Object.freeze(normalizeCandles(candles, (candle) => candle.tradeSession === 0)),
  });
}

/** Returns a fresh latest-bar window without changing the response array. */
export function windowCandles(candles, count = 120) {
  if (!Array.isArray(candles)) return [];
  const size = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 120;
  return candles.slice(-size);
}

function bucket(timestamp, period) {
  return Math.floor(timestamp / period) * period;
}

function isNewerDecimal(left, right) {
  return numeric(left) > numeric(right);
}

function isOlderDecimal(left, right) {
  return numeric(left) < numeric(right);
}

function mergeCandle(candle, quote) {
  const price = String(quote.lastDone);
  return {
    ...candle,
    close: price,
    high: isNewerDecimal(price, candle.high) ? price : candle.high,
    low: isOlderDecimal(price, candle.low) ? price : candle.low,
    volume: quote.volume ?? candle.volume,
  };
}

function appendCandle(quote, timestamp) {
  const price = String(quote.lastDone);
  return {
    timestamp: typeof quote.timestamp === "bigint" ? BigInt(timestamp) : timestamp,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: quote.volume ?? 0n,
    tradeSession: quote.tradeSession,
    ...(marketDay(quote) === null ? {} : { marketDay: marketDay(quote) }),
  };
}

/**
 * Immutably merges an active-mode Quote push. It never derives a trading day
 * from the local clock: daily buckets compare only provider market-day labels.
 */
export function mergeLiveChartQuote(symbol, mode, candles, quote) {
  const selected = modeFor(mode);
  if (!selected || !Array.isArray(candles) || !quote || quote.symbol !== symbol) return candles;
  if (selected.regularOnly && quote.tradeSession !== 0) return candles;
  const quoteTimestamp = timestampSeconds(quote.timestamp);
  if (quoteTimestamp === null || numeric(quote.lastDone) === null) return candles;

  const last = candles.at(-1);
  if (!last) return [appendCandle(quote, selected.period === "1D" ? quoteTimestamp : bucket(quoteTimestamp, PERIOD_SECONDS[selected.period]))];

  if (selected.period === "1D") {
    const activeDay = marketDay(quote);
    const lastDay = marketDay(last);
    if (activeDay === null || lastDay === null || activeDay < lastDay) return candles;
    if (activeDay === lastDay) return [...candles.slice(0, -1), mergeCandle(last, quote)];
    return [...candles, appendCandle(quote, quoteTimestamp)];
  }

  const period = PERIOD_SECONDS[selected.period];
  const activeBucket = bucket(quoteTimestamp, period);
  const lastTimestamp = timestampSeconds(last.timestamp);
  if (lastTimestamp === null) return candles;
  const lastBucket = bucket(lastTimestamp, period);
  if (activeBucket < lastBucket) return candles;
  if (activeBucket === lastBucket) return [...candles.slice(0, -1), mergeCandle(last, quote)];
  return [...candles, appendCandle(quote, activeBucket)];
}
