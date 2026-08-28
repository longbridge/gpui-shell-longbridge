import { View } from "gpui";
import {
  applyQuote,
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
    { ...waiting[0], tradeSession: 0, last: "1" },
    { ...waiting[1], tradeSession: 2, last: "1" },
    { ...waiting[2], tradeSession: 0, last: "1" },
  ]);
  check(
    sorted.map((quote) => quote.symbol).join(",") === "700.HK,D05.SG,AAPL.US",
    "TUI sort puts regular trading first, then market priority, stably",
  );

  const inferredSession = sortLikeTerminal(
    [
      { ...waiting[1], market: "US", last: "1" },
      { ...waiting[0], market: "HK", last: "1" },
      { ...waiting[2], market: "SG", last: "1" },
      { ...waiting[0], symbol: "600000.SH", market: "SH", last: "1" },
    ],
    Date.UTC(2026, 7, 26, 6, 59),
  );
  check(
    inferredSession.map((quote) => quote.symbol).join(",") === "700.HK,600000.SH,D05.SG,AAPL.US",
    "rows without an authoritative session infer the open market group while preserving market priority",
  );

  const mixedMarketSessions = sortLikeTerminal(
    [
      { ...waiting[1], symbol: ".SPX.US", market: "US", tradeSession: 0, last: "1" },
      { ...waiting[1], symbol: "AAPL.US", market: "US", tradeSession: 1, last: "1" },
      { ...waiting[1], symbol: "MSFT.US", market: "US", tradeSession: 1, last: "1" },
      { ...waiting[1], symbol: "AMD.US", market: "US", tradeSession: 1, last: "1" },
      { ...waiting[0], symbol: "700.HK", market: "HK", tradeSession: 0, last: "1" },
      { ...waiting[0], symbol: "300001.SZ", market: "SZ", tradeSession: 0, last: "1" },
      { ...waiting[0], symbol: "600000.SH", market: "SH", tradeSession: 0, last: "1" },
      { ...waiting[0], symbol: "300002.SZ", market: "SZ", tradeSession: 0, last: "1" },
      { ...waiting[2], symbol: "D05.SG", market: "SG", tradeSession: 0, last: "0.000" },
    ],
    Date.UTC(2026, 7, 26, 7, 0),
  );
  check(
    mixedMarketSessions.map((quote) => quote.symbol).join(",") ===
      "700.HK,300001.SZ,600000.SH,300002.SZ,.SPX.US,AAPL.US,MSFT.US,AMD.US,D05.SG",
    "market groups require usable quotes and retain their original item order",
  );

  const sessionPriority = sortLikeTerminal([
    { ...waiting[1], symbol: "AAPL.US", market: "US", tradeSession: 2, last: "1" },
    { ...waiting[0], symbol: "700.HK", market: "HK", tradeSession: 1, last: "1" },
    { ...waiting[2], symbol: "D05.SG", market: "SG", tradeSession: 0, last: "1" },
  ]);
  check(
    sessionPriority.map((quote) => quote.symbol).join(",") === "D05.SG,700.HK,AAPL.US",
    "open markets precede pre-market, which precedes all other sessions",
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

  const watchlist = initialQuotes(
    Array.from({ length: 200 }, (_, position) => ({
      symbol: `S${position}.US`,
      code: `S${position}`,
      name: `Security ${position}`,
      market: "US",
      currency: "USD",
    })),
  );
  check(
    applyQuote(watchlist, { symbol: "NOPE.US", lastDone: "1.00" }, 1) === watchlist,
    "a quote for a symbol outside the watchlist costs nothing",
  );
  const applied = applyQuote(
    watchlist,
    { symbol: "S7.US", lastDone: "12.50", prevClose: "10.00" },
    1_700_000_000_000,
  );
  check(applied !== watchlist, "applying a quote publishes a new list");
  check(
    applied[7].last === "12.50" && applied[7].changePercent === "+25.00%",
    "the addressed row merges like any other quote",
  );
  check(
    applied[6] === watchlist[6] && applied[8] === watchlist[8] && applied.length === 200,
    "every other row and the list order are left alone",
  );
  const sequenced = applyQuote(
    applied,
    { symbol: "S7.US", sequence: 9n, lastDone: "13.00" },
    1_700_000_000_001,
  );
  check(sequenced[7].last === "13.00", "a sequenced push lands on its row");
  check(
    applyQuote(sequenced, { symbol: "S7.US", sequence: 8n, lastDone: "1.00" }, 2) === sequenced,
    "an out-of-order push does not republish the list",
  );

  // The connect burst hands the whole watchlist to onQuote twice in one
  // synchronous run -- once from the REALTIME_QUOTE snapshot, once from the
  // isFirstPush subscription -- and all of it has to fit in the 500ms the
  // sandbox gives a single task. Re-sorting per quote cost ~3ms against a
  // 192-row list, so a real watchlist spent over a second here, the interrupt
  // unwound connectAndSubscribe past its own catch, and the stream was left
  // stranded at "snapshotting" with no heartbeat and no reconnect.
  let burst = watchlist;
  const started = Date.now();
  for (let pass = 0; pass < 2; pass += 1) {
    for (let position = 0; position < watchlist.length; position += 1) {
      burst = applyQuote(
        burst,
        { symbol: `S${position}.US`, lastDone: `${100 + pass}`, prevClose: "100" },
        1_700_000_000_000 + pass,
      );
    }
  }
  const elapsed = Date.now() - started;
  check(burst[7].last === "101", "the burst leaves the latest price in place");
  // The ceiling is loose on purpose. What this catches is the re-sort, which
  // cost ~3ms per quote against a 192-row list and put a real burst over a
  // second -- an order of magnitude clear of this bound either way. A tighter
  // one measures the machine instead: the whole vector suite runs in parallel,
  // and at 100ms this failed under that load while passing on its own.
  check(elapsed < 400, `a full connect burst must stay inside the task budget (took ${elapsed}ms)`);

  check(quoteFreshness(empty, 1_700_000_100_000) === "waiting", "empty row is waiting");
  check(quoteFreshness(pushed, pushed.receivedAt + 14_999) === "live", "recent row is live");
  check(quoteFreshness(pushed, pushed.receivedAt + 15_000) === "stale", "old row is stale");
  check(
    tradeStatusLabel({ tradeStatus: 1, tradeSession: 0 }) === "Halted",
    "halt status is visible",
  );
  check(
    tradeStatusLabel({ tradeStatus: 0, tradeSession: 0 }) === "Trading",
    "regular session uses the trading label",
  );
  check(
    tradeStatusLabel({ tradeStatus: 0, tradeSession: 2 }) === "Post-market",
    "extended session is visible",
  );
  check(
    tradeStatusLabel(
      { tradeStatus: 0, market: "HK", receivedAt: 1 },
      Date.UTC(2026, 7, 26, 12, 0),
    ) === "Closed",
    "a snapshot without an authoritative session does not claim HK is trading after close",
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
