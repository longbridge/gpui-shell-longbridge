function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function geometryValue(candle, name) {
  return numeric(candle?.geometry?.[name] ?? candle?.[name]);
}

function assertLayout(layout) {
  if (
    !layout ||
    ![layout.width, layout.height].every((value) => Number.isFinite(value) && value >= 0)
  ) {
    throw new TypeError("chart dimensions must be non-negative numbers");
  }
}

/**
 * Lays out normalized OHLC candles in plot-relative percentages.
 *
 * `wick` and `body` use 0–100 plot coordinates so the retained GPUI view can
 * paint them at any physical size. `hitBounds` reserves the complete slot,
 * including the visual gap, making first and last bars reachable at the edges.
 */
export function layoutCandles(series, layout) {
  if (!series || !Array.isArray(series.candles)) throw new TypeError("series must contain candles");
  assertLayout(layout);

  const source = series.candles;
  const values = source.map((candle) => ({
    candle,
    open: geometryValue(candle, "open"),
    high: geometryValue(candle, "high"),
    low: geometryValue(candle, "low"),
    close: geometryValue(candle, "close"),
  }));
  if (
    values.some(
      ({ open, high, low, close }) =>
        open === null || high === null || low === null || close === null,
    )
  ) {
    throw new TypeError("candles must contain finite OHLC geometry");
  }
  if (values.length === 0) {
    return Object.freeze({
      candles: Object.freeze([]),
      min: null,
      max: null,
      width: layout.width,
      height: layout.height,
    });
  }

  let min = values[0].low;
  let max = values[0].high;
  for (let index = 1; index < values.length; index += 1) {
    min = Math.min(min, values[index].low);
    max = Math.max(max, values[index].high);
  }
  const range = max - min;
  const count = values.length;
  const slotWidth = 100 / count;
  // A fifth of a slot produces a clear split at 120 bars without making
  // sparse charts look like a barcode. The body is never allowed to invert.
  const gap = slotWidth * 0.2;
  const bodyWidth = Math.max(0, slotWidth - gap);
  const toY = (value) => (range === 0 ? 50 : 100 - ((value - min) / range) * 100);
  const candles = values.map(({ candle, open, high, low, close }, index) => {
    const slotLeft = index * slotWidth;
    const bodyLeft = slotLeft + gap / 2;
    const bodyRight = bodyLeft + bodyWidth;
    const openY = toY(open);
    const closeY = toY(close);
    return Object.freeze({
      ...candle,
      wick: Object.freeze({ x: slotLeft + slotWidth / 2, top: toY(high), bottom: toY(low) }),
      body: Object.freeze({
        left: bodyLeft,
        right: bodyRight,
        top: Math.min(openY, closeY),
        bottom: Math.max(openY, closeY),
      }),
      hitBounds: Object.freeze({
        left: slotLeft,
        right: slotLeft + slotWidth,
        top: 0,
        bottom: 100,
      }),
    });
  });
  return Object.freeze({
    candles: Object.freeze(candles),
    min,
    max,
    width: layout.width,
    height: layout.height,
  });
}
