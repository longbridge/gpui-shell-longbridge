import { View } from "gpui";
import {
  depthRatio,
  mergeTrades,
  normalizeDepth,
  tradeIdentity,
  tradeVolumeRatio,
} from "./market_detail.js";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function trade(overrides = {}) {
  return {
    price: "189.50",
    volume: 10n,
    timestamp: 1_700_000_000n,
    tradeType: "T",
    direction: 1,
    tradeSession: 0,
    ...overrides,
  };
}

function runVectors() {
  const depthSnapshot = {
    symbol: "AAPL.US",
    asks: [
      { position: 4, price: "104", volume: 40n },
      { position: 2, price: "102", volume: 20n, orderNum: 2n },
      { position: 1, price: "101", volume: 10n, orderNum: 1n },
      { position: 3, price: "103", volume: 30n },
      { position: 5, price: "105", volume: 50n },
      { position: 6, price: "106", volume: 60n },
    ],
    bids: [
      { position: 3, price: "97", volume: 30n },
      { position: 1, price: "99", volume: 10n },
      { position: 2, price: "98", volume: 20n },
      { position: 5, price: "95", volume: 50n },
      { position: 4, price: "96", volume: 40n },
      { position: 6, price: "94", volume: 60n },
    ],
  };
  const depth = normalizeDepth(depthSnapshot);
  check(
    depth.symbol === "AAPL.US" && depth.asks.map((level) => level.position).join(",") === "1,2,3,4,5",
    "depth asks sort by source position and retain the nearest five levels",
  );
  check(
    depth.bids.map((level) => level.position).join(",") === "1,2,3,4,5",
    "depth bids sort by source position and retain the nearest five levels",
  );
  check(depth !== depthSnapshot && depth.asks !== depthSnapshot.asks, "depth normalization is immutable");

  const ratio = depthRatio(depth);
  check(
    ratio.bid === 150 / 300 && ratio.ask === 150 / 300,
    "depth ratio uses visible bid and ask volume totals",
  );
  check(
    depthRatio({ bids: [{ volume: 0n }], asks: [{ volume: 0n }] }).bid === 0 &&
      depthRatio({ bids: [], asks: [] }).ask === 0,
    "zero visible depth has zero ratios",
  );

  const current = [
    trade({ timestamp: 12n, price: "12.00", volume: 2n }),
    trade({ timestamp: 10n, price: "10.00", volume: 1n }),
  ];
  const incoming = [
    trade({ timestamp: 11n, price: "11.00", volume: 1n }),
    trade({ timestamp: 12n, price: "12.00", volume: 2n }),
    trade({ timestamp: 10n, price: "9.99", volume: 9n, tradeType: "A", direction: 2, tradeSession: 1 }),
  ];
  const merged = mergeTrades(current, incoming);
  check(
    merged.map((item) => item.timestamp.toString()).join(",") === "12,11,10,10" && merged.length === 4,
    "trades de-duplicate by stable identity and sort newest first",
  );
  check(merged !== current && merged[0] !== incoming[1], "trade merging is immutable");
  check(
    tradeIdentity(current[0]) === "12|12.00|2|T|1|0",
    "trade identity uses the complete stable trade fields",
  );
  const tied = mergeTrades(
    [],
    [
      trade({ timestamp: 1n, price: "9", volume: 2n, tradeType: "A", direction: 1, tradeSession: 0 }),
      trade({ timestamp: 1n, price: "10", volume: 1n, tradeType: "A", direction: 1, tradeSession: 0 }),
    ],
  );
  check(tied[0].price === "10", "trade ties use price as a deterministic secondary key");
  const retained = mergeTrades(
    [],
    Array.from({ length: 21 }, (_, index) => trade({ timestamp: BigInt(index), price: String(index) })),
  );
  check(retained.length === 20 && retained[0].timestamp === 20n && retained.at(-1).timestamp === 1n, "trades retain the newest twenty records");

  check(tradeVolumeRatio(25n, 100n) === 0.5, "trade volume scaling uses square-root magnitude");
  check(tradeVolumeRatio(-25n, 100n) === 0.5, "trade volume scaling uses absolute volume");
  check(tradeVolumeRatio(0n, 0n) === 0, "trade volume scaling handles zero maximum");
}

runVectors();

export default class MarketDetailVectorProbe extends View {
  render() {
    return { type: "text", text: "ok" };
  }
}
