import LongbridgeApp from "./main.js";

export default class TitleBarProbe extends LongbridgeApp {
  init() {
    this.hasStoredTokens = false;
    this.followsSystemTheme = true;
    this.page = "watchlist";
    this.status = { state: "offline" };
  }

  render(cx) {
    return this.titleBar(cx.theme());
  }
}
