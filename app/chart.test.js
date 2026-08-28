import { View } from "gpui";
import {
  findNearestPricePoint,
  formatMarketTime,
  layoutIntradaySeries,
  layoutPriceSeries,
  mergeLiveQuote,
  prepareFiveDaySeries,
  priceWindowChange,
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
  // A renderer that concatenates sessions, loses a boundary, or scales without
  // the previous close must fail these geometry-facing intraday assertions.
  const intradayGeometry = layoutIntradaySeries(
    {
      candles: [
        { ...candle("2026-08-28T20:00:00Z", 101, 3), geometry: Object.freeze({ close: 101 }) },
        { ...candle("2026-08-29T13:30:00Z", 102, 1), geometry: Object.freeze({ close: 102 }) },
        { ...candle("2026-08-29T14:30:00Z", 103, 0), geometry: Object.freeze({ close: 103 }) },
        { ...candle("2026-08-29T20:00:00Z", 104, 2), geometry: Object.freeze({ close: 104 }) },
      ],
      sessionBoundaries: [
        { index: 0, tradeSession: 3 },
        { index: 1, tradeSession: 1 },
        { index: 2, tradeSession: 0 },
        { index: 3, tradeSession: 2 },
      ],
      previousClose: "100",
    },
    { width: 300, height: 100 },
  );
  check(
    intradayGeometry.sessionSegments.map((segment) => segment.tradeSession).join(",") === "3,1,0,2",
    "intraday line geometry keeps a segment for every provider session",
  );
  check(
    intradayGeometry.sessionBoundaries.map((boundary) => boundary.x).join(",") === "0,100,200,300",
    "intraday session boundaries occupy their chronological plot positions",
  );
  check(
    intradayGeometry.previousClose.price === 100 && intradayGeometry.previousClose.y === 100,
    "intraday geometry includes a previous-close reference line in the shared range",
  );
  check(
    intradayGeometry.points[0].x === 0 && intradayGeometry.points.at(-1).x === 300,
    "intraday line spans the complete session timeline",
  );

  const continuousIntraday = layoutIntradaySeries(
    {
      candles: [
        { ...candle("2026-08-28T20:00:00Z", 101, 3), geometry: Object.freeze({ close: 101 }) },
        { ...candle("2026-08-28T20:01:00Z", 102, 3), geometry: Object.freeze({ close: 102 }) },
        { ...candle("2026-08-29T13:30:00Z", 103, 1), geometry: Object.freeze({ close: 103 }) },
        { ...candle("2026-08-29T13:31:00Z", 104, 1), geometry: Object.freeze({ close: 104 }) },
        { ...candle("2026-08-29T14:30:00Z", 105, 0), geometry: Object.freeze({ close: 105 }) },
        { ...candle("2026-08-29T14:31:00Z", 106, 0), geometry: Object.freeze({ close: 106 }) },
      ],
      sessionBoundaries: [
        { index: 0, tradeSession: 3 },
        { index: 2, tradeSession: 1 },
        { index: 4, tradeSession: 0 },
      ],
    },
    { width: 300, height: 100 },
  );
  const drawablePairs = continuousIntraday.sessionSegments.flatMap((segment) =>
    segment.points.slice(1).map((point, index) => `${segment.points[index].close}-${point.close}`),
  );
  check(
    drawablePairs.join(",") === "101-102,102-103,103-104,104-105,105-106",
    "session segments include every adjacent chronological pair, including boundaries",
  );

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
  check(
    formatMarketTime("AAPL.US", Number(unix("2026-03-09T13:30:00Z"))) === "09:30",
    "formats a US hover time in New York daylight time",
  );
  check(
    formatMarketTime("AAPL.US", Number(unix("2026-01-09T14:30:00Z"))) === "09:30",
    "formats a US hover time in New York standard time",
  );
  check(
    formatMarketTime("700.HK", Number(unix("2026-08-24T02:00:00Z"))) === "10:00",
    "formats an HK hover time in Hong Kong time",
  );
  check(
    formatMarketTime("AAPL.US", Number(unix("2026-01-09T14:30:45Z")), true) === "09:30:45",
    "can retain seconds for a market-local trade tape",
  );
  const usLaidOut = layoutPriceSeries(us, { width: 500, height: 100, dayGap: 10 });
  check(
    usLaidOut.points[0].date === "2026-03-08" && usLaidOut.points.at(-1).date === "2026-03-09",
    "laid-out US hover points retain New York trading dates across DST",
  );

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
    laidOut.points[0].date === series.points[0].date &&
      laidOut.points.at(-1).date === series.points.at(-1).date,
    "laid-out hover points retain market-local trading dates",
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

  // Preparing and laying out five days costs more than a frame, and the render
  // loop asks for both on every tick. Both are cached on the identity of what
  // they were given, so these pin down that the cache answers a repeat and —
  // the part that would silently print stale prices — that it never answers a
  // question it was not asked.
  const cacheable = [candle("2026-08-24T02:00:00Z", 10), candle("2026-08-25T02:00:00Z", 20)];
  const first = prepareFiveDaySeries("700.HK", cacheable);
  check(prepareFiveDaySeries("700.HK", cacheable) === first, "a repeated series is not rebuilt");

  const sameContentDifferentArray = prepareFiveDaySeries("700.HK", [...cacheable]);
  check(
    sameContentDifferentArray !== first &&
      sameContentDifferentArray.points.map((point) => point.close).join(",") === "10,20",
    "a fresh array is prepared again rather than assumed unchanged",
  );
  const grown = prepareFiveDaySeries("700.HK", [...cacheable, candle("2026-08-26T02:00:00Z", 30)]);
  check(
    grown.points.map((point) => point.close).join(",") === "10,20,30",
    "an appended live candle reaches the prepared series",
  );
  check(
    prepareFiveDaySeries("700.HK", cacheable).points.length === 2,
    "the earlier array still prepares to its own contents",
  );
  // The market decides the local day, so the symbol is part of the question.
  check(
    prepareFiveDaySeries("AAPL.US", cacheable).symbol === "AAPL.US",
    "a different symbol is not served the previous symbol's series",
  );

  const box = { width: 480, height: 132, dayGap: 8 };
  const laid = layoutPriceSeries(first, box);
  check(layoutPriceSeries(first, box) === laid, "a repeated layout is not recomputed");
  const narrow = layoutPriceSeries(first, { width: 240, height: 132, dayGap: 8 });
  check(
    narrow !== laid && narrow.width === 240 && narrow.points.at(-1).x === 240,
    "a resized plot is laid out again rather than reusing the old geometry",
  );
  check(
    layoutPriceSeries(first, box).points.at(-1).x === 480,
    "the original plot width survives a differently sized neighbour",
  );

  // The extremes drive the vertical mapping; they are scanned rather than
  // spread through `Math.min`, which a day of one-minute candles overruns.
  const many = Array.from({ length: 4000 }, (_, index) =>
    candle(new Date(Date.parse("2026-08-24T02:00:00Z") + index * 60_000).toISOString(), index + 1),
  );
  const wide = layoutPriceSeries(prepareFiveDaySeries("700.HK", many), box);
  check(wide.min === 1 && wide.max === 4000, "extremes hold for a full day of minute candles");

  // New York daylight saving is resolved per year and remembered; a series that
  // steps over New Year must not be dated with the previous year's boundaries.
  const newYear = prepareFiveDaySeries("AAPL.US", [
    candle("2025-12-30T14:30:00Z", 1),
    candle("2026-01-02T14:30:00Z", 2),
    candle("2026-07-01T13:30:00Z", 3),
    candle("2025-12-31T14:30:00Z", 4),
  ]);
  check(
    newYear.days.map((day) => day.date).join(",") === "2025-12-30,2025-12-31,2026-01-02,2026-07-01",
    "market-local dates stay correct across a year boundary and a DST change",
  );

  // A 480 px plot cannot separate 400 candles, let alone the 1950 of five full
  // US sessions, and every drawn point costs ~17 µs in the description tree. So
  // the layout draws at most one point per two pixels. The whole risk of that
  // is here: a downsample that loses a price is worse than a slow chart,
  // because the line it draws is one the market never traded.
  const minuteOf = (iso, index) => new Date(Date.parse(iso) + index * 60_000).toISOString();
  const spikeCandles = Array.from({ length: 400 }, (_, index) =>
    candle(minuteOf("2026-08-24T01:30:00Z", index), 100),
  );
  spikeCandles[137] = candle(minuteOf("2026-08-24T01:30:00Z", 137), 180);
  spikeCandles[251] = candle(minuteOf("2026-08-24T01:30:00Z", 251), 20);

  const spiky = prepareFiveDaySeries("700.HK", spikeCandles);
  check(spiky.points.length === 400, "the prepared series still carries every candle");
  const plotted = layoutPriceSeries(spiky, { width: 480, height: 132, dayGap: 8 });
  check(plotted.points.length < 400, "a session denser than the plot is thinned");
  check(plotted.points.length <= 242, "the drawn points stay inside the plot's budget");
  check(
    plotted.points.some((point) => point.close === 180),
    "the one-minute spike high survives downsampling",
  );
  check(
    plotted.points.some((point) => point.close === 20),
    "the one-minute spike low survives downsampling",
  );
  check(plotted.min === 20 && plotted.max === 180, "the plotted range is the range that traded");

  // Stated as the comparison it is. Both spikes sit on prime indices, so no
  // even sample of this series at any stride from 2 to 7 contains either one.
  const evenStride = Math.ceil(spiky.points.length / plotted.points.length);
  check(
    evenStride >= 2 &&
      !spiky.points.some(
        (point, index) => index % evenStride === 0 && (point.close === 180 || point.close === 20),
      ),
    "sampling every Nth candle instead would have deleted both spikes",
  );

  // Nothing is averaged or invented: every drawn point is a candle that traded,
  // which is what lets `findNearestPricePoint` keep naming a real minute.
  const tradedCloses = new Map(spiky.points.map((point) => [point.timestamp, point.close]));
  check(
    plotted.points.every((point) => tradedCloses.get(point.timestamp) === point.close),
    "every drawn point is a real candle rather than a synthesised one",
  );
  check(
    plotted.points.every((point, index) => index === 0 || point.x >= plotted.points[index - 1].x),
    "drawn points stay in plot order, which the hover search assumes",
  );
  check(
    plotted.points[0].x === 0 &&
      plotted.points.at(-1).x === 480 &&
      plotted.points.at(-1).timestamp === spiky.points.at(-1).timestamp,
    "the line spans the plot and still ends on the latest candle",
  );
  check(
    findNearestPricePoint(plotted, 480) === plotted.points.at(-1),
    "hover still resolves against the downsampled geometry",
  );

  // Sessions are bucketed apart, so a day never borrows a neighbour's candle
  // and the reserved gaps between days stay where the layout put them.
  const twoDays = [
    ...Array.from({ length: 300 }, (_, index) =>
      candle(minuteOf("2026-08-24T01:30:00Z", index), 100 + index),
    ),
    ...Array.from({ length: 300 }, (_, index) =>
      candle(minuteOf("2026-08-25T01:30:00Z", index), 500 - index),
    ),
  ];
  const dense = prepareFiveDaySeries("700.HK", twoDays);
  const denseGeometry = layoutPriceSeries(dense, { width: 480, height: 132, dayGap: 8 });
  check(
    dense.days.length === 2 &&
      dense.days.every((day, dayIndex) => {
        const drawn = denseGeometry.points.filter((point) => point.dayIndex === dayIndex);
        return (
          drawn[0].timestamp === day.points[0].timestamp &&
          drawn.at(-1).timestamp === day.points.at(-1).timestamp
        );
      }),
    "each session keeps its own first and last candle so the day gaps hold",
  );
  check(
    denseGeometry.points[1].x - denseGeometry.points[0].x < 8,
    "thinning does not stretch a session across the gap reserved for the next",
  );

  // The chart tones its line, its gradient and its hover block by the direction
  // of the window it is drawing, so that reading is data rather than styling and
  // is asserted here. It is the window's own move: the last drawn close against
  // the first, never against a previous close the geometry does not carry.
  check(priceWindowChange(laidOut) === 4, "a rising window reads as its own net change");
  const falling = layoutPriceSeries(
    prepareFiveDaySeries("700.HK", [
      candle("2026-08-24T02:00:00Z", 9),
      candle("2026-08-24T02:01:00Z", 4),
    ]),
    { width: 500, height: 100, dayGap: 10 },
  );
  check(priceWindowChange(falling) === -5, "a falling window reads negative");
  const flat = layoutPriceSeries(
    prepareFiveDaySeries("700.HK", [
      candle("2026-08-24T02:00:00Z", 7),
      candle("2026-08-24T02:01:00Z", 7),
    ]),
    { width: 500, height: 100, dayGap: 10 },
  );
  check(priceWindowChange(flat) === 0, "a flat window has no direction");
  check(priceWindowChange({ points: [] }) === 0, "an empty window has no direction");
  check(priceWindowChange(undefined) === 0, "a missing geometry has no direction");

  // Downsampling may not repaint the chart. Each session keeps its own first and
  // last candle, so a thinned window starts and ends on the same closes the full
  // one did and the colour cannot flip with the point budget.
  check(
    denseGeometry.points.length < dense.points.length &&
      priceWindowChange(denseGeometry) === priceWindowChange(dense) &&
      priceWindowChange(denseGeometry) === 101,
    "thinning the drawn points cannot move the window's direction",
  );

  // The budget is an input, so it is part of the question the cache answers.
  const tight = layoutPriceSeries(spiky, { width: 480, height: 132, dayGap: 8, maxPoints: 40 });
  check(tight.points.length <= 42, "an explicit point budget is honoured");
  check(
    tight.points.some((point) => point.close === 180) &&
      tight.points.some((point) => point.close === 20),
    "the extremes survive even a budget of forty points",
  );
  check(
    layoutPriceSeries(spiky, { width: 480, height: 132, dayGap: 8 }).points.length ===
      plotted.points.length,
    "a layout is not served geometry built for a different point budget",
  );
}

runVectors();

export default class ChartVectorProbe extends View {}
