import { View } from "gpui";
import { layoutCandles } from "./candlestick_chart.js";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const candle = (open, high, low, close, timestamp = 0n) => ({
  timestamp,
  open: String(open),
  high: String(high),
  low: String(low),
  close: String(close),
  geometry: Object.freeze({
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
  }),
});

function closeEnough(actual, expected) {
  return Math.abs(actual - expected) < 0.0001;
}

function runVectors() {
  // Removing the high/low mapping, or swapping open and close, must make these
  // extrema and body-edge assertions fail.
  const rising = layoutCandles(
    { candles: [candle(10, 15, 8, 12, 1n)] },
    { width: 100, height: 80 },
  );
  const up = rising.candles[0];
  check(rising.min === 8 && rising.max === 15, "candle geometry ranges over wick extrema");
  check(
    closeEnough(up.wick.top, 0) && closeEnough(up.wick.bottom, 100),
    "a rising candle wick reaches its high and low extrema",
  );
  check(
    closeEnough(up.body.top, 42.8571428571) && closeEnough(up.body.bottom, 71.4285714286),
    "a rising candle body places close above open",
  );
  check(
    up.hitBounds.left === 0 && up.hitBounds.right === 100,
    "a sole candle is hittable across its slot",
  );

  const falling = layoutCandles(
    { candles: [candle(12, 15, 8, 10, 2n)] },
    { width: 100, height: 80 },
  ).candles[0];
  check(
    closeEnough(falling.body.top, 42.8571428571) && closeEnough(falling.body.bottom, 71.4285714286),
    "a falling candle body places open above close",
  );

  const flat = layoutCandles(
    { candles: [candle(10, 10, 10, 10, 3n), candle(10, 10, 10, 10, 4n)] },
    { width: 120, height: 80 },
  );
  check(
    flat.candles.every((item) =>
      [item.wick.top, item.wick.bottom, item.body.top, item.body.bottom].every(
        (value) => Number.isFinite(value) && value === 50,
      ),
    ),
    "flat zero-range candles remain finite at the plot centre",
  );
  check(
    flat.candles[0].hitBounds.left === 0 && flat.candles.at(-1).hitBounds.right === 100,
    "first and last candle hit bounds meet the plot edges",
  );

  const dense = layoutCandles(
    { candles: Array.from({ length: 120 }, (_, index) => candle(10, 11, 9, 10, BigInt(index))) },
    { width: 480, height: 80 },
  );
  check(
    dense.candles.every((item) => item.body.right > item.body.left) &&
      dense.candles[1].body.left > dense.candles[0].body.right,
    "120 candles retain a readable gap between adjacent bodies",
  );

  const empty = layoutCandles({ candles: [] }, { width: 100, height: 80 });
  check(
    empty.min === null && empty.max === null && empty.candles.length === 0,
    "empty candle geometry is finite and empty",
  );
}

runVectors();

export default class CandlestickChartVectorProbe extends View {
  render() {
    return { type: "text", text: "ok" };
  }
}
