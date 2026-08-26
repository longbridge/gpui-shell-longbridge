import { View } from "gpui";

import {
  findNearestPricePoint,
  layoutPriceSeries,
  mergeLiveQuote,
  prepareFiveDaySeries,
} from "./chart.js";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const unix = (iso) => BigInt(Date.parse(iso) / 1000);
const candle = (iso, close, tradeSession = 0) => ({
  timestamp: unix(iso),
  close: String(close),
  open: String(close),
  high: String(close),
  low: String(close),
  volume: 1n,
  tradeSession,
});

function runVectors() {
  const series = prepareFiveDaySeries("700.HK", [
    candle("2026-08-19T02:00:00Z", 3),
    candle("2026-08-17T02:00:00Z", 1),
    candle("2026-08-18T02:00:00Z", 2),
    candle("2026-08-20T02:00:00Z", 4),
    candle("2026-08-21T02:00:00Z", 5),
    candle("2026-08-24T02:00:00Z", 6),
    candle("2026-08-24T03:00:00Z", 999, 1),
  ]);
  check(series.days.length === 5, "retains five actual trading days");
  check(series.days[0].date === "2026-08-18", "drops the oldest sixth day");
  check(series.days.at(-1).date === "2026-08-24", "groups by HK market-local date");
  check(series.points.length === 5, "filters non-intraday candles");
  check(
    series.points.map((point) => point.close).join(",") === "2,3,4,5,6",
    "sorts chronologically",
  );

  const us = prepareFiveDaySeries("AAPL.US", [
    candle("2026-03-09T00:30:00Z", 1),
    candle("2026-03-09T13:30:00Z", 2),
  ]);
  check(us.days[0].date === "2026-03-08", "uses New York DST for local dates");
  check(us.days[1].date === "2026-03-09", "separates adjacent US local dates");

  const laidOut = layoutPriceSeries(series, { width: 500, height: 100, dayGap: 10 });
  check(laidOut.points[0].x === 0 && laidOut.points.at(-1).x === 500, "uses full plot width");
  check(
    laidOut.points[0].y === 100 && laidOut.points.at(-1).y === 0,
    "maps price range vertically",
  );
  check(
    laidOut.points[1].x - laidOut.points[0].x > 100,
    "reserves a visible gap between trading days",
  );
  check(
    findNearestPricePoint(laidOut, 0) === laidOut.points[0],
    "hover selects the first point at the leading edge",
  );
  check(
    findNearestPricePoint(laidOut, 500) === laidOut.points.at(-1),
    "hover selects the last point at the trailing edge",
  );
  const middle = (laidOut.points[1].x + laidOut.points[2].x) / 2;
  check(
    findNearestPricePoint(laidOut, middle - 0.01) === laidOut.points[1] &&
      findNearestPricePoint(laidOut, middle + 0.01) === laidOut.points[2],
    "hover switches at the midpoint between adjacent points",
  );
  check(findNearestPricePoint({ points: [] }, 10) === null, "empty geometry has no hover point");

  // The hover card names the market-local day it is pointing at, and it reads
  // that off the laid-out point rather than off the prepared series.
  check(
    laidOut.points.every((point) => typeof point.date === "string" && point.date.length === 10),
    "every laid-out point carries the market-local date its hover label prints",
  );
  check(
    laidOut.points.map((point) => point.date).join(",") ===
      series.points.map((point) => point.date).join(","),
    "layout keeps the dates the prepared series assigned",
  );

  const base = [candle("2026-08-26T14:30:00Z", 100)];
  const updated = mergeLiveQuote("AAPL.US", base, {
    symbol: "AAPL.US",
    timestamp: unix("2026-08-26T14:30:45Z"),
    lastDone: "103",
    tradeSession: 0,
  });
  check(updated.length === 1 && updated[0].close === "103", "updates the current minute");
  check(updated[0].high === "103" && updated[0].low === "100", "updates current minute range");
  check(base[0].close === "100", "live merge does not mutate cached history");

  const appended = mergeLiveQuote("AAPL.US", updated, {
    symbol: "AAPL.US",
    timestamp: unix("2026-08-26T14:31:01Z"),
    lastDone: "102",
    tradeSession: 0,
    volume: 12n,
  });
  check(appended.length === 2 && appended[1].open === "102", "appends a new live minute");
  check(
    mergeLiveQuote("AAPL.US", appended, {
      symbol: "AAPL.US",
      timestamp: unix("2026-08-26T14:32:00Z"),
      lastDone: "104",
      tradeSession: 1,
    }) === appended,
    "ignores non-intraday live quotes",
  );
}

runVectors();

export default class ChartVectorProbe extends View {}
