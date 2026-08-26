import { View } from "gpui";

import { portfolioPresentation } from "./portfolio.js";

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
);

if (presentation.holdings[0].todayPnl !== "+30.00") throw new Error("USD daily P/L");
if (presentation.holdings[0].totalPnl !== "+80.00") throw new Error("USD total P/L");
if (presentation.holdings[0].totalPnlPercent !== "+4.44%") throw new Error("USD total P/L percent");
if (presentation.holdings[1].todayPnl !== "-100.00") throw new Error("HKD daily P/L");
if (presentation.holdings[1].totalPnl !== "-200.00") throw new Error("HKD total P/L");
if (presentation.summaries.map((summary) => summary.currency).join(",") !== "USD,HKD")
  throw new Error("currency summaries retain first-seen order");
if (presentation.summaries[0].todayPnl !== "+30.00") throw new Error("USD summary");
if (presentation.summaries[1].totalPnl !== "-200.00") throw new Error("HKD summary");

const missingQuote = portfolioPresentation(
  [{ symbol: "MSFT.US", quantity: "2", costPrice: "400", currency: "USD" }],
  [],
);
if (missingQuote.holdings[0].todayPnl !== "--" || missingQuote.holdings[0].totalPnl !== "--")
  throw new Error("missing quotes must not look like losses");
if (missingQuote.summaries.length !== 0) throw new Error("missing quotes cannot enter summaries");

export default class PortfolioVectorProbe extends View {}
