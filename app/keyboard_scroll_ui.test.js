import KeymapUiProbe from "./keymap_ui.test.js";

export default class KeyboardScrollUiProbe extends KeymapUiProbe {
  init(props, cx) {
    super.init(props, cx);
    this.statusBarVisible = false;
    this.calendarOpen = false;
    this.diagnosticsOpen = false;
    this.instruments = [];
    this.quotes = [];
    for (let index = 0; index < 40; index += 1) {
      const code = `KEY${String(index).padStart(2, "0")}`;
      const symbol = `${code}.US`;
      this.instruments.push({ symbol, code, name: `Keyboard Row ${index}`, market: "US" });
      this.quotes.push({
        symbol,
        code,
        name: `Keyboard Row ${index}`,
        market: "US",
        currency: "USD",
        last: String(100 + index),
        prevClose: "99.00",
        open: "99.00",
        high: "101.00",
        low: "98.00",
        change: "+1.00",
        changePercent: "+1.00%",
        volume: 1_000n,
        turnover: "100000",
        tradeStatus: 0,
        tradeSession: 0,
        updatedAt: 1_780_000_000_000,
        receivedAt: 1_780_000_000_000,
        sequence: BigInt(index + 1),
      });
    }
    this.selectedSymbol = "KEY00.US";
  }
}
