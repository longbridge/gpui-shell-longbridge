import { View } from "gpui";
import {
  accountTotals,
  allocationInUsd,
  allocationSliceAt,
  foldAllocationSlices,
  normalizeUsdRates,
  portfolioPresentation,
  quoteIndex,
} from "./portfolio.js";

const rates = normalizeUsdRates({
  exchanges: [{ base_currency: "HKD", other_currency: "USD", average_rate: "0.128" }],
});

const presentation = portfolioPresentation(
  [
    {
      symbol: "AAPL.US",
      name: "Apple",
      quantity: "10",
      available: "8",
      costPrice: "180",
      currency: "USD",
    },
    {
      symbol: "700.HK",
      name: "Tencent",
      quantity: "20",
      available: "20",
      costPrice: "600",
      currency: "HKD",
    },
  ],
  [
    { symbol: "AAPL.US", last: "188", prevClose: "185" },
    { symbol: "700.HK", last: "590", prevClose: "595" },
  ],
  rates,
);

if (presentation.holdings[0].todayPnl !== "+30.00") throw new Error("USD daily P/L");
if (presentation.holdings[0].totalPnl !== "+80.00") throw new Error("USD total P/L");
if (presentation.holdings[0].totalPnlPercent !== "+4.44%") throw new Error("USD total P/L percent");
if (presentation.holdings[1].todayPnl !== "-12.80") throw new Error("HKD daily P/L in USD");
if (presentation.holdings[1].totalPnl !== "-25.60") throw new Error("HKD total P/L in USD");
if (presentation.summaries.length !== 1 || presentation.summaries[0].currency !== "USD")
  throw new Error("portfolio summary is consolidated in USD");
if (presentation.summaries[0].todayPnl !== "+17.20") throw new Error("USD summary");
if (presentation.summaries[0].totalPnl !== "+54.40") throw new Error("USD total summary");

const missingQuote = portfolioPresentation(
  [{ symbol: "MSFT.US", quantity: "2", costPrice: "400", currency: "USD" }],
  [],
);
if (missingQuote.holdings[0].todayPnl !== "--" || missingQuote.holdings[0].totalPnl !== "--")
  throw new Error("missing quotes must not look like losses");
if (missingQuote.summaries.length !== 0) throw new Error("missing quotes cannot enter summaries");

const allocation = allocationInUsd(
  [
    { symbol: "AAPL.US", name: "Apple", quantity: "10", currency: "USD" },
    { symbol: "MSFT.US", name: "Microsoft", quantity: "5", currency: "USD" },
    { symbol: "700.HK", name: "Tencent", quantity: "20", currency: "HKD" },
    { symbol: "D05.SG", name: "DBS", quantity: "4", currency: "SGD" },
  ],
  [
    { symbol: "AAPL.US", last: "200" },
    { symbol: "MSFT.US", last: "400" },
    { symbol: "700.HK", last: "500" },
  ],
  rates,
);
if (allocation.currency !== "USD" || allocation.total !== 5280 || allocation.slices.length !== 3)
  throw new Error("allocation is consolidated in USD");
if (Math.abs(allocation.slices[2].value - 1280) > 0.001)
  throw new Error("HKD allocation converts to USD");
if (allocation.unpriced.length !== 1 || allocation.unpriced[0].symbol !== "D05.SG")
  throw new Error("unpriced holdings are reported without entering the donut");

// The donut assigns a fixed hue per wedge, so the wedge count has to be
// bounded: everything past the limit becomes one grey remainder rather than
// borrowing a hue that already names a different holding.
const ranked = foldAllocationSlices(allocation);
if (ranked.length !== 3) throw new Error("an allocation under the limit keeps every slice");
// AAPL and MSFT are both 2000 USD; a stable sort leaves the tie in the order
// the holdings arrived, and 700.HK converts to 1280 USD behind them.
if (ranked.map((slice) => slice.symbol).join(",") !== "AAPL.US,MSFT.US,700.HK")
  throw new Error("wedges are ordered largest first");
if (ranked.some((slice) => slice.other)) throw new Error("nothing is folded below the limit");

const wide = {
  currency: "USD",
  total: 280,
  unpriced: [],
  slices: [
    { symbol: "A.US", name: "A", value: 100, percent: 35.714 },
    { symbol: "B.US", name: "B", value: 60, percent: 21.429 },
    { symbol: "C.US", name: "C", value: 40, percent: 14.286 },
    { symbol: "D.US", name: "D", value: 30, percent: 10.714 },
    { symbol: "E.US", name: "E", value: 20, percent: 7.143 },
    { symbol: "F.US", name: "F", value: 18, percent: 6.429 },
    { symbol: "G.US", name: "G", value: 12, percent: 4.286 },
  ],
};
const folded = foldAllocationSlices(wide);
if (folded.length !== 6) throw new Error("five identified wedges plus one remainder");
if (folded.slice(0, 5).some((slice) => slice.other))
  throw new Error("only the tail loses its identity");
const other = folded[5];
if (!other.other || other.name !== "Other (2 positions)")
  throw new Error("the remainder names how many positions it stands for");
if (Math.abs(other.value - 30) > 0.001) throw new Error("the remainder keeps the folded value");
if (Math.abs(other.percent - 10.715) > 0.001)
  throw new Error("the remainder keeps the folded share");
if (Math.abs(folded.reduce((total, slice) => total + slice.value, 0) - wide.total) > 0.001)
  throw new Error("folding conserves the total the ring is drawn from");

const shuffled = foldAllocationSlices({ ...wide, slices: [...wide.slices].reverse() });
if (shuffled.map((slice) => slice.symbol).join(",") !== folded.map((s) => s.symbol).join(","))
  throw new Error("the ring does not depend on the order holdings arrived in");

// A page that shows both readings of the same quotes should index them once.
// Handing either reading a prepared index has to land on the same numbers as
// handing it the concatenated array, including which of two lists owns a symbol
// they share: the later list, as the spread it replaces gave.
const watchlistQuotes = [
  { symbol: "AAPL.US", last: "200", prevClose: "190" },
  { symbol: "700.HK", last: "111", prevClose: "111" },
];
const positionQuotes = [
  { symbol: "700.HK", last: "500", prevClose: "495" },
  { symbol: "MSFT.US", last: "400", prevClose: "390" },
];
const indexedHoldings = [
  { symbol: "AAPL.US", name: "Apple", quantity: "10", costPrice: "180", currency: "USD" },
  { symbol: "MSFT.US", name: "Microsoft", quantity: "5", costPrice: "300", currency: "USD" },
  { symbol: "700.HK", name: "Tencent", quantity: "20", costPrice: "600", currency: "HKD" },
];
const concatenated = [...watchlistQuotes, ...positionQuotes];
const shared = quoteIndex(watchlistQuotes, positionQuotes);
if (shared.get("700.HK").last !== "500")
  throw new Error("the later quote list owns a symbol both lists carry");
if (
  JSON.stringify(portfolioPresentation(indexedHoldings, shared, rates)) !==
  JSON.stringify(portfolioPresentation(indexedHoldings, concatenated, rates))
)
  throw new Error("a shared quote index presents the holdings identically");
if (
  JSON.stringify(allocationInUsd(indexedHoldings, shared, rates)) !==
  JSON.stringify(allocationInUsd(indexedHoldings, concatenated, rates))
)
  throw new Error("a shared quote index allocates identically");

// Three wedges -- a quarter, a quarter and a half -- drawn from twelve
// o'clock. The point of these is that where the pointer says it is matches
// where the path was drawn: a wedge cannot be hovered by asking the runtime,
// because every wedge is painted into the same square.
const ringSlices = [
  { symbol: "A.US", value: 25 },
  { symbol: "B.US", value: 25 },
  { symbol: "C.US", value: 50 },
];
const ringBox = { width: 148, height: 148 };
const quarterTurn = Math.PI / 2;
const ringPoint = (angle, radius) => ({
  x: 74 + Math.cos(angle - Math.PI / 2) * ((radius / 50) * 74),
  y: 74 + Math.sin(angle - Math.PI / 2) * ((radius / 50) * 74),
});
const ringCases = [
  [
    allocationSliceAt(ringSlices, 100, ringPoint(quarterTurn * 0.5, 40), ringBox) === "A.US",
    "the first wedge starts at twelve o'clock and runs clockwise",
  ],
  [
    allocationSliceAt(ringSlices, 100, ringPoint(quarterTurn * 1.5, 40), ringBox) === "B.US",
    "the second quarter is the second wedge",
  ],
  [
    allocationSliceAt(ringSlices, 100, ringPoint(Math.PI * 1.5, 40), ringBox) === "C.US",
    "the half that closes the ring is the third wedge",
  ],
  [
    allocationSliceAt(ringSlices, 100, { x: 74, y: 74 }, ringBox) === null,
    "the hole in the middle is not a wedge",
  ],
  [
    // The rim reaches the box's edges, so past it is a corner.
    allocationSliceAt(ringSlices, 100, { x: 2, y: 2 }, ringBox) === null,
    "past the rim is not a wedge",
  ],
  [
    allocationSliceAt(ringSlices, 100, ringPoint(0.5, 40), { width: 0, height: 0 }) === null &&
      allocationSliceAt([], 100, ringPoint(0.5, 40), ringBox) === null &&
      allocationSliceAt(ringSlices, 0, ringPoint(0.5, 40), ringBox) === null,
    "a ring with no size, no slices or no total is under nothing",
  ],
  [
    allocationSliceAt(
      [
        { symbol: "A.US", value: 25 },
        { symbol: "Z.US", value: 0 },
        { symbol: "C.US", value: 75 },
      ],
      100,
      ringPoint(quarterTurn * 1.5, 40),
      ringBox,
    ) === "C.US",
    "a wedge with no value is not drawn and cannot be pointed at",
  ],
];
for (const [held, message] of ringCases) if (!held) throw new Error(message);

// What the account holds is the sum of its positions and its cash, and the
// account endpoint does not report it: `net_assets` is net of what was
// borrowed to hold those positions. On the account this was found on, the two
// were 89,027 and 3,169 -- an order of magnitude apart -- so the endpoint's
// number in the place a reader looks for the total is a different question
// answered, not a small error.
const totals = accountTotals(allocation, "1.52");
if (totals.currency !== "USD" || Math.abs(totals.total - 5281.52) > 0.001)
  throw new Error("total assets are the positions plus the cash beside them");
if (Math.abs(totals.positions - 5280) > 0.001 || Math.abs(totals.cash - 1.52) > 0.001)
  throw new Error("and each half stays available on its own");
// The fixture holds a Singapore position with no quote, so this total is short
// by whatever that is worth. A short total written as a plain number reads as
// a fact, so it says it is short.
if (!totals.partial) throw new Error("a total missing a position must say so");
if (accountTotals({ total: 10, unpriced: [] }, "5").partial)
  throw new Error("and must not say so when it is missing nothing");
if (accountTotals({ total: 10, unpriced: [] }, "--").total !== 10)
  throw new Error("cash the endpoint did not report is not a number to add");

export default class PortfolioVectorProbe extends View {}
