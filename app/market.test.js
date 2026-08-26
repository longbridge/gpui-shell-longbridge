import { View } from "gpui";

import {
  formatCompactNumber,
  initialQuotes,
  mergeQuote,
  quoteFreshness,
  sortLikeTerminal,
  streamStatusSummary,
  tradeStatusLabel,
  watchlistInstruments,
} from "./market.js";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function runVectors() {
  const instruments = watchlistInstruments({
    data: {
      groups: [
        {
          id: "1",
          name: "Main",
          securities: [
            { symbol: "700.HK", name: "Tencent", market: "HK", is_pinned: false },
            { symbol: "AAPL.US", name: "Apple", market: "US", is_pinned: true },
          ],
        },
        {
          id: "2",
          name: "Second",
          securities: [
            { symbol: "AAPL.US", name: "Duplicate", market: "US" },
            { symbol: "D05.SG", name: "DBS Group", market: "SG" },
          ],
        },
      ],
    },
  });
  check(instruments.length === 3, "API watchlist groups are flattened and deduplicated");
  check(
    instruments[0].symbol === "700.HK" &&
      instruments[1].name === "Apple" &&
      instruments[2].currency === "SGD",
    "API group and security order is preserved with display metadata",
  );

  const waiting = initialQuotes(instruments);
  const empty = waiting[1];
  check(
    empty.symbol === "AAPL.US" && empty.last === "--" && empty.receivedAt === 0,
    "initial row is waiting",
  );
  const sorted = sortLikeTerminal([
    { ...waiting[0], tradeSession: 0 },
    { ...waiting[1], tradeSession: 2 },
    { ...waiting[2], tradeSession: 0 },
  ]);
  check(
    sorted.map((quote) => quote.symbol).join(",") === "700.HK,D05.SG,AAPL.US",
    "TUI sort puts regular trading first, then market priority, stably",
  );

  const inferredSession = sortLikeTerminal(
    [
      { ...waiting[1], market: "US" },
      { ...waiting[0], market: "HK" },
      { ...waiting[2], market: "SG" },
      { ...waiting[0], symbol: "600000.SH", market: "SH" },
    ],
    Date.UTC(2026, 7, 26, 7, 59),
  );
  check(
    inferredSession.map((quote) => quote.symbol).join(",") === "700.HK,D05.SG,AAPL.US,600000.SH",
    "snapshot rows infer open markets before the first trade-session push",
  );

  const snapshot = mergeQuote(
    empty,
    {
      symbol: "AAPL.US",
      lastDone: "188.00",
      prevClose: "180.00",
      open: "182.50",
      high: "190.25",
      low: "181.00",
      timestamp: 1_700_000_000n,
      volume: 8_589_934_592n,
      turnover: "1590000000.50",
      tradeStatus: 0,
    },
    1_700_000_001_000,
  );
  check(
    snapshot.last === "188.00" && snapshot.prevClose === "180.00",
    "snapshot populates quote prices",
  );
  check(
    snapshot.change === "+8.00" && snapshot.changePercent === "+4.44%",
    "change is derived from previous close",
  );
  check(
    snapshot.volume === 8_589_934_592n && snapshot.updatedAt === 1_700_000_000_000,
    "large counters and exchange time stay exact",
  );

  const pushed = mergeQuote(
    snapshot,
    {
      symbol: "AAPL.US",
      sequence: 42n,
      lastDone: "189.50",
      timestamp: 1_700_000_005n,
      currentVolume: 100n,
    },
    1_700_000_006_000,
  );
  check(
    pushed.prevClose === "180.00" && pushed.open === "182.50",
    "partial push preserves snapshot fields",
  );
  check(
    pushed.change === "+9.50" && pushed.changePercent === "+5.28%",
    "partial push recomputes derived change",
  );
  check(
    pushed.sequence === 42n && pushed.receivedAt === 1_700_000_006_000,
    "push records ordering and receipt time",
  );

  const stale = mergeQuote(
    pushed,
    {
      symbol: "AAPL.US",
      sequence: 41n,
      lastDone: "1.00",
    },
    1_700_000_007_000,
  );
  check(stale === pushed, "out-of-order push cannot roll a quote backward");

  const pushFirst = mergeQuote(
    empty,
    {
      symbol: "AAPL.US",
      sequence: 50n,
      lastDone: "191.00",
      open: "183.00",
      timestamp: 1_700_000_010n,
      volume: 9_000_000_000n,
    },
    1_700_000_011_000,
  );
  const lateSnapshot = mergeQuote(
    pushFirst,
    {
      symbol: "AAPL.US",
      lastDone: "188.00",
      prevClose: "180.00",
      open: "182.50",
      timestamp: 1_700_000_000n,
      volume: 8_589_934_592n,
    },
    1_700_000_012_000,
  );
  check(
    lateSnapshot.last === "191.00" && lateSnapshot.open === "183.00",
    "late snapshot cannot overwrite a sequenced push",
  );
  check(
    lateSnapshot.prevClose === "180.00" && lateSnapshot.changePercent === "+6.11%",
    "late snapshot still fills fields absent from push",
  );

  check(quoteFreshness(empty, 1_700_000_100_000) === "waiting", "empty row is waiting");
  check(quoteFreshness(pushed, pushed.receivedAt + 14_999) === "live", "recent row is live");
  check(quoteFreshness(pushed, pushed.receivedAt + 15_000) === "stale", "old row is stale");
  check(
    tradeStatusLabel({ tradeStatus: 1, tradeSession: 0 }) === "Halted",
    "halt status is visible",
  );
  check(
    tradeStatusLabel({ tradeStatus: 0, tradeSession: 2 }) === "Post-market",
    "extended session is visible",
  );
  check(
    formatCompactNumber(8_589_934_592n) === "8.59B",
    "billions stay compact and exact enough to scan",
  );
  check(formatCompactNumber(1_234_567n) === "1.23M", "millions stay compact");
  check(formatCompactNumber(0n) === "--", "missing counters do not look like market data");
  check(
    streamStatusSummary({ state: "connected" }) === "Streaming",
    "connected feed has concise copy",
  );
  check(
    streamStatusSummary({
      state: "reconnecting",
      delay: 2_000,
      error: "authentication rejected",
    }) === "Retrying in 2s · authentication rejected",
    "reconnect reason stays visible",
  );
}

runVectors();

export default class MarketVectorProbe extends View {}
