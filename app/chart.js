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

// The daylight-saving boundaries only ever depend on the year, but a five-day
// intraday history asks for them once per candle. Holding the last year's
// answer turns three `Date` allocations per candle into three per batch; the
// cached entry is keyed by the year's own UTC bounds, so a timestamp outside
// them recomputes exactly what the uncached form would have returned.
let newYorkYear = null;

function newYorkOffsetSeconds(timestamp) {
  if (newYorkYear === null || timestamp < newYorkYear.start || timestamp >= newYorkYear.end) {
    const year = new Date(timestamp * 1000).getUTCFullYear();
    newYorkYear = {
      start: Date.UTC(year, 0, 1) / 1000,
      end: Date.UTC(year + 1, 0, 1) / 1000,
      dstStart: nthSundayUtc(year, 2, 2, 7),
      dstEnd: nthSundayUtc(year, 10, 1, 6),
    };
  }
  return timestamp >= newYorkYear.dstStart && timestamp < newYorkYear.dstEnd
    ? -4 * 3600
    : -5 * 3600;
}

function marketOffsetSeconds(symbol, timestamp) {
  return symbol.endsWith(".US") ? newYorkOffsetSeconds(timestamp) : 8 * 3600;
}

/** Formats a timestamp in the trading market's wall-clock time. */
export function formatMarketTime(symbol, timestamp, includeSeconds = false) {
  const seconds = timestampSeconds(timestamp);
  if (typeof symbol !== "string" || seconds === null) return "";
  const local = new Date((seconds + marketOffsetSeconds(symbol, seconds)) * 1000);
  const hour = String(local.getUTCHours()).padStart(2, "0");
  const minute = String(local.getUTCMinutes()).padStart(2, "0");
  if (!includeSeconds) return `${hour}:${minute}`;
  return `${hour}:${minute}:${String(local.getUTCSeconds()).padStart(2, "0")}`;
}

/**
 * The market-local calendar day a timestamp falls in, as a whole number of days
 * since the epoch. Two timestamps share a market-local date exactly when this
 * matches, so grouping can key on the number and pay for the `YYYY-MM-DD`
 * string once per day rather than once per candle.
 */
function localDayNumber(symbol, timestamp) {
  return Math.floor((timestamp + marketOffsetSeconds(symbol, timestamp)) / DAY_SECONDS);
}

function dateFromLocalDay(localDay) {
  const local = new Date(localDay * DAY_SECONDS * 1000);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function computeFiveDaySeries(symbol, candlesticks) {
  // The history is fetched two weeks deep but only five days are drawn, so the
  // per-candle copy is deferred until the surviving days are known: sorting and
  // grouping run over parallel arrays and carry nothing but an index.
  const sources = [];
  const stamps = [];
  const closes = [];
  for (const candle of candlesticks) {
    // Written to match the filter it replaces exactly, down to which inputs it
    // refuses: a nullish candle reaches the timestamp read and throws there.
    if (candle?.tradeSession !== undefined && candle.tradeSession !== 0) continue;
    const timestamp = timestampSeconds(candle.timestamp);
    if (timestamp === null) continue;
    const close = numeric(candle.close);
    if (close === null) continue;
    sources.push(candle);
    stamps.push(timestamp);
    closes.push(close);
  }

  const order = stamps.map((_, index) => index);
  // Ties fall back to arrival order, which is what a stable sort of the candles
  // themselves gave.
  order.sort((left, right) => stamps[left] - stamps[right] || left - right);

  // Keyed by day number rather than by adjacency: a daylight-saving change can
  // walk the market-local day backwards for an hour, and the date-string map
  // this replaces folded those candles into the day they belong to.
  const grouped = new Map();
  for (const index of order) {
    const localDay = localDayNumber(symbol, stamps[index]);
    let bucket = grouped.get(localDay);
    if (bucket === undefined) {
      bucket = [];
      grouped.set(localDay, bucket);
    }
    bucket.push(index);
  }

  const selected = [...grouped.entries()].slice(-5);
  const days = selected.map(([localDay, indices]) => ({
    date: dateFromLocalDay(localDay),
    points: indices.map((index) => ({
      ...sources[index],
      timestamp: stamps[index],
      close: closes[index],
    })),
  }));
  const points = days.flatMap((day, dayIndex) =>
    day.points.map((point) => ({ ...point, date: day.date, dayIndex })),
  );
  return { symbol, days, points };
}

// Rebuilding the series costs more than the whole frame budget, and the render
// loop asks for it far more often than it changes: a quote for any of the other
// watched symbols, and the one-second clock, both redraw the chart from
// candles that did not move. `mergeLiveQuote` and the history load replace the
// array rather than mutating it, so its identity is a sound cache key — a
// caller that mutates candles in place must hand over a new array.
let preparedSeries = null;

/** Filters regular-session history and retains the latest five market-local trading days. */
export function prepareFiveDaySeries(symbol, candlesticks) {
  if (typeof symbol !== "string") throw new TypeError("symbol must be a string");
  if (!Array.isArray(candlesticks)) throw new TypeError("candlesticks must be an array");

  if (
    preparedSeries !== null &&
    preparedSeries.symbol === symbol &&
    preparedSeries.candlesticks === candlesticks
  ) {
    return preparedSeries.series;
  }
  const series = computeFiveDaySeries(symbol, candlesticks);
  preparedSeries = { symbol, candlesticks, series };
  return series;
}

/**
 * The indices of one session's candles worth drawing when the session holds
 * more of them than the plot can keep apart: the highest and the lowest close
 * of every `stride` candles, in the order they occurred, plus the session's
 * own first and last.
 *
 * Sampling evenly — every Nth candle — would be shorter and is wrong. It
 * deletes spikes, and a price line that has lost the day's high is not a
 * coarser chart, it is a false one: it shows a move that did not happen.
 * Keeping both extremes of a bucket instead makes the bucket's vertical extent
 * exactly the real data's, so nothing can vanish off the top or the bottom.
 * What is given up is only the shape of the path *within* one bucket, which is
 * a few pixels wide and drawn by a 1.5 px stroke.
 *
 * Largest-triangle-three-buckets is the usual answer here and draws a slightly
 * nicer line per point retained, but it keeps one point per bucket and so has
 * to choose between that bucket's high and its low. That is the one choice a
 * quote chart may not make, so it is not used.
 */
function extremaIndices(dayPoints, stride) {
  const count = dayPoints.length;
  if (count === 0) return [];
  const kept = [];
  let bucket = 0;
  let lowIndex = 0;
  let highIndex = 0;
  for (let index = 1; index <= count; index += 1) {
    // A day's candles are evenly spaced across the day's share of the plot, so
    // a pixel-column boundary is a fixed number of candles wide: the bucket can
    // be read off the index without laying the point out first.
    const bucketAt = index === count ? -1 : Math.floor(index / stride);
    if (bucketAt !== bucket) {
      if (lowIndex === highIndex) kept.push(lowIndex);
      else if (lowIndex < highIndex) kept.push(lowIndex, highIndex);
      else kept.push(highIndex, lowIndex);
      bucket = bucketAt;
      lowIndex = index;
      highIndex = index;
      continue;
    }
    // `dayPoints[lowIndex].close <= dayPoints[highIndex].close` holds, so a
    // close under the low cannot also be over the high.
    const close = dayPoints[index].close;
    if (close < dayPoints[lowIndex].close) lowIndex = index;
    else if (close > dayPoints[highIndex].close) highIndex = index;
  }
  // The session's own edges anchor the gaps between trading days, and the last
  // candle of the last day is the latest price — dropping it would end the
  // line at a price the symbol never traded at just now.
  if (kept[0] !== 0) kept.unshift(0);
  if (kept[kept.length - 1] !== count - 1) kept.push(count - 1);
  return kept;
}

function computePriceGeometry(series, width, height, dayGap, maxPoints) {
  const seriesPoints = series.points;
  if (seriesPoints.length === 0) {
    return { ...series, width, height, min: null, max: null, points: [] };
  }
  // A day of one-minute candles is thousands of arguments; spreading them into
  // `Math.min` is both slower than a scan and bounded by the argument limit.
  let min = seriesPoints[0].close;
  let max = min;
  for (let index = 1; index < seriesPoints.length; index += 1) {
    const close = seriesPoints[index].close;
    if (close < min) min = close;
    else if (close > max) max = close;
  }
  const range = max - min;
  const gaps = Math.max(0, series.days.length - 1);
  const drawable = Math.max(0, width - dayGap * gaps);
  const intervalCounts = series.days.map((day) => Math.max(0, day.points.length - 1));
  const totalIntervals = intervalCounts.reduce((sum, count) => sum + count, 0);
  const fallbackSpan = series.days.length > 1 ? drawable / (series.days.length - 1) : 0;
  // Two candles survive each bucket, so a budget of `maxPoints` buys half as
  // many buckets. Below one candle per bucket every candle already has a pixel
  // column to itself and there is nothing to shed.
  const buckets = Math.max(1, Math.floor(maxPoints / 2));
  const stride = totalIntervals > buckets ? totalIntervals / buckets : 0;
  let consumedIntervals = 0;
  const points = [];
  for (let dayIndex = 0; dayIndex < series.days.length; dayIndex += 1) {
    const day = series.days[dayIndex];
    const visible = stride > 0 ? extremaIndices(day.points, stride) : null;
    const drawn = visible === null ? day.points.length : visible.length;
    for (let slot = 0; slot < drawn; slot += 1) {
      // The x of a retained candle is the x it would have had undownsampled:
      // the plot is laid out over every candle and only the drawing of them is
      // thinned, so the line keeps its shape and its session gaps.
      const pointIndex = visible === null ? slot : visible[slot];
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
        // this the hover label reads an undefined date before its local time.
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

// The geometry only moves when the series, the plot box, or the point budget
// does, and the last two are fixed. Keyed on the prepared series' identity,
// which `prepareFiveDaySeries` already keeps stable across the redraws that did
// not touch the candles.
let priceGeometry = null;

/**
 * Converts a prepared series to pixel geometry while reserving gaps between
 * sessions, drawing no more points than the plot can tell apart.
 *
 * `maxPoints` defaults to one point per two pixels of plot width. What a point
 * costs is not spent here: it is the ~17 µs the description tree spends
 * marshalling each one through `PathBuilder`, measured in `docs/render-cost.md`,
 * which is 83% of the chart's render and grows with however much history the
 * API happened to return. Five full US sessions of one-minute candles is 1950
 * points over a 480 px plot — four per pixel column, three of them invisible.
 * Capping the drawn points makes that cost flat in the length of the history
 * instead of linear in it.
 */
export function layoutPriceSeries(
  series,
  { width, height, dayGap = 8, maxPoints = Math.max(2, Math.round(width / 2)) },
) {
  if (!series || !Array.isArray(series.days)) throw new TypeError("series must be prepared");
  if (![width, height, dayGap].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new TypeError("chart dimensions must be non-negative numbers");
  }
  if (!(Number.isFinite(maxPoints) && maxPoints >= 2)) {
    throw new TypeError("maxPoints must be a number of at least 2");
  }

  if (
    priceGeometry !== null &&
    priceGeometry.series === series &&
    priceGeometry.width === width &&
    priceGeometry.height === height &&
    priceGeometry.dayGap === dayGap &&
    priceGeometry.maxPoints === maxPoints
  ) {
    return priceGeometry.geometry;
  }
  const geometry = computePriceGeometry(series, width, height, dayGap, maxPoints);
  priceGeometry = { series, width, height, dayGap, maxPoints, geometry };
  return geometry;
}

function intradayClose(candle) {
  return numeric(candle?.geometry?.close ?? candle?.close);
}

function sessionStarts(series, points) {
  if (Array.isArray(series.sessionBoundaries)) {
    return series.sessionBoundaries
      .filter(
        (boundary) =>
          Number.isInteger(boundary?.index) &&
          boundary.index >= 0 &&
          boundary.index < points.length,
      )
      .map((boundary) => ({ index: boundary.index, tradeSession: boundary.tradeSession }));
  }
  const starts = [];
  let previous = Symbol("first session");
  for (let index = 0; index < points.length; index += 1) {
    if (points[index].tradeSession !== previous) {
      starts.push({ index, tradeSession: points[index].tradeSession });
      previous = points[index].tradeSession;
    }
  }
  return starts;
}

/**
 * Converts the complete provider-labelled trading day into a continuous line
 * while retaining its session splits and previous-close reference. Unlike the
 * five-day renderer, this never derives a session from local wall-clock time.
 */
export function layoutIntradaySeries(series, { width, height }) {
  if (!series || !Array.isArray(series.candles)) throw new TypeError("series must contain candles");
  if (![width, height].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new TypeError("chart dimensions must be non-negative numbers");
  }
  const source = series.candles;
  const closes = source.map(intradayClose);
  if (closes.some((close) => close === null))
    throw new TypeError("candles must contain finite close geometry");
  const previousPrice = numeric(series.previousClose?.close ?? series.previousClose);
  if (source.length === 0) {
    return Object.freeze({
      points: Object.freeze([]),
      sessionSegments: Object.freeze([]),
      sessionBoundaries: Object.freeze([]),
      previousClose:
        previousPrice === null ? null : Object.freeze({ price: previousPrice, y: height / 2 }),
      min: previousPrice,
      max: previousPrice,
      width,
      height,
    });
  }

  let min = closes[0];
  let max = closes[0];
  for (let index = 1; index < closes.length; index += 1) {
    min = Math.min(min, closes[index]);
    max = Math.max(max, closes[index]);
  }
  if (previousPrice !== null) {
    min = Math.min(min, previousPrice);
    max = Math.max(max, previousPrice);
  }
  const range = max - min;
  const toY = (value) => (range === 0 ? height / 2 : height - ((value - min) / range) * height);
  const points = source.map((candle, index) =>
    Object.freeze({
      ...candle,
      close: closes[index],
      x: source.length === 1 ? width / 2 : (index / (source.length - 1)) * width,
      y: toY(closes[index]),
    }),
  );
  const starts = sessionStarts(series, points);
  const sessionBoundaries = starts.map(({ index, tradeSession }) =>
    Object.freeze({ index, tradeSession, x: points[index].x, timestamp: points[index].timestamp }),
  );
  const sessionSegments = starts.map(({ index, tradeSession }, startIndex) => {
    const end = starts[startIndex + 1]?.index ?? points.length;
    // Later session paths start at the preceding candle. This draws the
    // chronological connector at the boundary while the new session supplies
    // its own tone for the portion that follows the marker.
    const start = startIndex === 0 ? index : index - 1;
    return Object.freeze({ tradeSession, points: Object.freeze(points.slice(start, end)) });
  });
  return Object.freeze({
    points: Object.freeze(points),
    sessionSegments: Object.freeze(sessionSegments),
    sessionBoundaries: Object.freeze(sessionBoundaries),
    previousClose:
      previousPrice === null
        ? null
        : Object.freeze({ price: previousPrice, y: toY(previousPrice) }),
    min,
    max,
    width,
    height,
  });
}

/**
 * The direction of the charted window: the last drawn close less the first.
 *
 * This is the only reading the chart itself can make about its own series, and
 * it is what tones the line. It is deliberately the *window's* move and not the
 * session's: the plot spans five days, so its colour must answer the question
 * the plot asks, which is where the price is against where these five days
 * started — not against yesterday's close, which the geometry never carries.
 *
 * Downsampling cannot move it. `extremaIndices` always keeps each session's own
 * first and last candle, so the first and last points of the geometry are the
 * first and last candles of the window whether or not anything between them was
 * shed. Zero — a flat window, or no data at all — is a direction too, and the
 * caller paints it in the neutral foreground rather than picking a side.
 *
 * @param {{ points?: Array<{ close: unknown }> }} geometry
 * @returns {number}
 */
export function priceWindowChange(geometry) {
  const points = geometry?.points;
  if (!Array.isArray(points) || points.length === 0) return 0;
  const first = numeric(points[0].close);
  const last = numeric(points.at(-1).close);
  if (first === null || last === null) return 0;
  return last - first;
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
