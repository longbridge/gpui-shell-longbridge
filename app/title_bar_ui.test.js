import LongbridgeApp from "./main.js";
import { set_theme } from "gpui-base";
import { setOmarchyMarketColors } from "./palette.js";

const CONTRASTING_DARK_THEME = {
  appearance: "dark",
  tokens: {
    colors: {
      background: "#080b12",
      foreground: "#f4f7ff",
      surface: "#080b12",
      surface_foreground: "#f4f7ff",
      primary: "#6aa8ff",
      primary_foreground: "#080b12",
      secondary: "#182033",
      secondary_foreground: "#f4f7ff",
      muted: "#182033",
      muted_foreground: "#9ba9c5",
      accent: "#24304a",
      accent_foreground: "#f4f7ff",
      destructive: "#ff758f",
      destructive_foreground: "#080b12",
      border: "#31405f",
      input: "#31405f",
      ring: "#6aa8ff",
      selection: "#2a3550",
    },
    spacing: { xxs: 2, xs: 4, sm: 8, md: 12, lg: 14, xl: 18, xxl: 24 },
    radius: { none: 0, sm: 2, md: 0, lg: 0, xl: 0, full: 9999 },
  },
};

export default class TitleBarProbe extends LongbridgeApp {
  init() {
    set_theme(CONTRASTING_DARK_THEME);
    setOmarchyMarketColors({
      info: "#20d9ff",
      warning: "#f5c76d",
      danger: "#ff758f",
    });
    this.hasStoredTokens = false;
    this.followsSystemTheme = true;
    this.page = "watchlist";
    this.status = { state: "offline" };
  }

  render(cx) {
    return this.titleBar(cx.theme());
  }
}
