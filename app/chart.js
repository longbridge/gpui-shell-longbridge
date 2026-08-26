const DAY_SECONDS = 86_400;

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampSeconds(value) {
  const parsed = typeof value === "bigint" ? Number(value) : value;
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function nthSundayUtc(year, month, nth, hour) {
  const first = new Date(Date.UTC(year, month, 1));
  const day = 1 + ((7 - first.getUTCDay()) % 7) + (nth - 1) * 7;
  return Date.UTC(year, month, day, hour) / 1000;
}

function newYorkOffsetSeconds(timestamp) {
  const year = new Date(timestamp * 1000).getUTCFullYear();
  const dstStart = nthSundayUtc(year, 2, 2, 7);
  const dstEnd = nthSundayUtc(year, 10, 1, 6);
  return timestamp >= dstStart && timestamp < dstEnd ? -4 * 3600 : -5 * 3600;
}

function marketOffsetSeconds(symbol, timestamp) {
  return symbol.endsWith(".US") ? newYorkOffsetSeconds(timestamp) : 8 * 3600;
}

function dateKey(symbol, timestamp) {
  const local = new Date((timestamp + marketOffsetSeconds(symbol, timestamp)) * 1000);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Filters regular-session history and retains the latest five market-local trading days. */
export function prepareFiveDaySeries(symbol, candlesticks) {
  if (typeof symbol !== "string") throw new TypeError("symbol must be a string");
  if (!Array.isArray(candlesticks)) throw new TypeError("candlesticks must be an array");

  const valid = candlesticks
    .filter((candle) => candle?.tradeSession === undefined || candle.tradeSession === 0)
    .map((candle) => ({
      ...candle,
      timestamp: timestampSeconds(candle.timestamp),
      close: numeric(candle.close),
    }))
    .filter((candle) => candle.timestamp !== null && candle.close !== null)
    .sort((left, right) => left.timestamp - right.timestamp);

  const grouped = new Map();
  for (const point of valid) {
    const date = dateKey(symbol, point.timestamp);
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date).push(point);
  }
  const selected = [...grouped.entries()].slice(-5);
  const days = selected.map(([date, points]) => ({ date, points }));
  const points = days.flatMap((day, dayIndex) =>
    day.points.map((point) => ({ ...point, date: day.date, dayIndex })),
  );
  return { symbol, days, points };
}

/** Converts a prepared series to pixel geometry while reserving gaps between sessions. */
export function layoutPriceSeries(series, { width, height, dayGap = 8 }) {
  if (!series || !Array.isArray(series.days)) throw new TypeError("series must be prepared");
  if (![width, height, dayGap].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new TypeError("chart dimensions must be non-negative numbers");
  }
  const closes = series.points.map((point) => point.close);
  if (closes.length === 0) return { ...series, width, height, min: null, max: null, points: [] };
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min;
  const gaps = Math.max(0, series.days.length - 1);
  const drawable = Math.max(0, width - dayGap * gaps);
  const intervalCounts = series.days.map((day) => Math.max(0, day.points.length - 1));
  const totalIntervals = intervalCounts.reduce((sum, count) => sum + count, 0);
  const fallbackSpan = series.days.length > 1 ? drawable / (series.days.length - 1) : 0;
  let consumedIntervals = 0;
  const points = [];
  for (let dayIndex = 0; dayIndex < series.days.length; dayIndex += 1) {
    const day = series.days[dayIndex];
    for (let pointIndex = 0; pointIndex < day.points.length; pointIndex += 1) {
      const intervalPosition = consumedIntervals + pointIndex;
      const x =
        totalIntervals > 0
          ? (intervalPosition / totalIntervals) * drawable + dayIndex * dayGap
          : dayIndex * (fallbackSpan + dayGap);
      const close = numeric(day.points[pointIndex].close);
      points.push({
        ...day.points[pointIndex],
        // The grouped candles a day holds never carried the day's own key —
        // `prepareFiveDaySeries` adds it when it flattens them, and this
        // rebuilds from `days` rather than from that flattened list. Without
        // this the hover label reads "undefined 13:54 UTC".
        date: day.date,
        close,
        dayIndex,
        x,
        y: range === 0 ? height / 2 : height - ((close - min) / range) * height,
      });
    }
    consumedIntervals += intervalCounts[dayIndex];
  }
  return { ...series, width, height, min, max, points };
}

/** Returns the chart point nearest to a plot-local x coordinate. */
export function findNearestPricePoint(geometry, x) {
  const points = geometry?.points;
  if (!Array.isArray(points) || points.length === 0 || !Number.isFinite(x)) return null;
  if (x <= points[0].x) return points[0];
  if (x >= points.at(-1).x) return points.at(-1);
  let low = 0;
  let high = points.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].x <= x) low = middle;
    else high = middle;
  }
  return x - points[low].x <= points[high].x - x ? points[low] : points[high];
}

/** Immutably merges an intraday quote push into minute candles. */
export function mergeLiveQuote(symbol, candlesticks, quote) {
  if (
    !quote ||
    quote.symbol !== symbol ||
    quote.tradeSession !== 0 ||
    !Array.isArray(candlesticks)
  ) {
    return candlesticks;
  }
  const timestamp = timestampSeconds(quote.timestamp);
  const price = numeric(quote.lastDone);
  if (timestamp === null || price === null) return candlesticks;
  const minute = Math.floor(timestamp / 60) * 60;
  const last = candlesticks.at(-1);
  const lastTimestamp = last ? timestampSeconds(last.timestamp) : null;
  const lastMinute = lastTimestamp === null ? null : Math.floor(lastTimestamp / 60) * 60;
  if (lastMinute !== null && minute < lastMinute) return candlesticks;

  if (lastMinute === minute) {
    const previousHigh = numeric(last.high) ?? price;
    const previousLow = numeric(last.low) ?? price;
    return [
      ...candlesticks.slice(0, -1),
      {
        ...last,
        close: String(quote.lastDone),
        high: String(Math.max(previousHigh, price)),
        low: String(Math.min(previousLow, price)),
        timestamp: BigInt(minute),
        volume: quote.volume ?? last.volume,
      },
    ];
  }

  const priceString = String(quote.lastDone);
  return [
    ...candlesticks,
    {
      close: priceString,
      open: priceString,
      low: priceString,
      high: priceString,
      volume: quote.volume ?? 0n,
      timestamp: BigInt(minute),
      tradeSession: 0,
    },
  ];
}
