import LongbridgeApp from "./main.js";

function quote(index) {
  const code = `TEST${String(index).padStart(2, "0")}`;
  return {
    symbol: `${code}.US`,
    code,
    name: `Test security ${index + 1}`,
    market: "US",
    currency: "USD",
    last: `${100 + index}.00`,
    prevClose: `${99 + index}.00`,
    open: `${99 + index}.50`,
    high: `${101 + index}.25`,
    low: `${98 + index}.75`,
    volume: BigInt(1_000_000 + index),
    turnover: String(2_000_000 + index),
    tradeStatus: 0,
    tradeSession: 0,
    sequence: BigInt(index + 1),
    updatedAt: 1_700_000_000_000 + index,
    receivedAt: 1_700_000_001_000 + index,
    change: "+1.00",
    changePercent: "+1.01%",
  };
}

export default class WorkspaceUiProbe extends LongbridgeApp {
  init() {
    // Enough rows to exercise the authenticated table path; the host-level
    // scroll test separately materializes every native overflow direction.
    this.quotes = Array.from({ length: 12 }, (_, index) => quote(index));
    this.instruments = this.quotes.map(({ symbol, code, name, market }) => ({
      symbol,
      code,
      name,
      market,
    }));
    this.selectedSymbol = this.quotes[0].symbol;
    this.page = "watchlist";
    this.hasStoredTokens = true;
    this.status = { state: "connected" };
    this.authorization = null;
    this.account = null;
    this.fxRates = new Map([["USD", 1]]);
    this.holdings = [];
    this.error = "";
    this.streamError = "";
    this.stream = null;
    this.streamGeneration = 0;
    this.connectedToken = "test";
    this.lastTick = 1_700_000_006_000;
    this.quotePulse = 1;
    this.candleCache = new Map([
      [
        this.selectedSymbol,
        [
          { timestamp: 1_699_920_000n, close: "98", tradeSession: 0 },
          { timestamp: 1_700_006_400n, close: "100", tradeSession: 0 },
        ],
      ],
    ]);
    this.chartState = { symbol: this.selectedSymbol, state: "ready" };
    this.chartGeneration = 0;
    this.clock = null;
  }

  render(cx) {
    return this.watchlistPage(cx.theme());
  }
}
