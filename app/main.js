// A standalone, read-only Longbridge desktop client. OAuth uses direct HTTP,
// quotes use the documented WebSocket protocol, and no trading API is exposed.

import { View, div, svg } from "gpui";
import { holdContext } from "./context.js";
import {
  CalendarState,
  DockArea,
  InputState,
  Popover,
  Scrollbar,
  Table,
  TableBody,
  Tab,
  Tabs,
  dock_area,
  dock_content,
  h_flex,
  set_theme,
  v_flex,
  v_virtual_list,
} from "gpui-base";
import { fps_monitor } from "gpui-fps";
import { readFile } from "fs/promises";
import { exit, platform } from "process";
import {
  accessToken,
  beginDeviceAuthorization,
  clearTokens,
  loadTokens,
  pollDeviceAuthorization,
} from "./auth.js";
import { get } from "./http.js";
import {
  applyQuotes,
  filterRows,
  initialQuotes,
  sortLikeTerminal,
  streamStatusSummary,
  watchlistInstruments,
} from "./market.js";
import { createQuoteStream } from "./quote_stream.js";
import { compactFiveDaySeries, prepareFiveDaySeries } from "./chart.js";
import {
  CHART_MODES,
  chartRequestIdentity,
  mergeLiveChartQuote,
  prepareCandleSeries,
  prepareIntradaySeries,
  windowCandles,
} from "./chart_modes.js";
import { PERIOD, TRADE_SESSION } from "./protocol.js";
import { depthRatio, mergeTrades, normalizeDepth, validDepthLevel } from "./market_detail.js";
import { allocationInUsd, normalizeUsdRates, portfolioPresentation } from "./portfolio.js";
import PriceChartView, {
  PRICE_CHART_LAYOUT,
  compactIntradaySeriesForView,
} from "./price_chart_view.js";
import { loadFpsVisible, saveFpsVisible } from "./fps_preference.js";
import { omarchyBaseColors, omarchyMarketColors, omarchyTheme } from "./system_theme.js";
import { setOmarchyAvatarColors, setOmarchyMarketColors, statusColors } from "./palette.js";
import {
  ChartPanel,
  MarketDetailPanel,
  QuoteDetailsPanel,
  WatchlistPanel,
  holdWorkspaceApp,
} from "./workspace.js";
import {
  accordionGroup,
  accordionSection,
  action,
  allocationChart,
  connectionPill,
  detailToggle,
  detailGrid,
  emptyPanel,
  kbd,
  errorMessage,
  filterInput,
  HOLDING_ROW_HEIGHT,
  PANE_INSET,
  WATCHLIST_MIN_WIDTH,
  dockDropHint,
  dockFrame,
  dockTabBar,
  TABLE_HEADER_HEIGHT,
  holdingRow,
  holdingsHeader,
  label,
  deviceCodeBox,
  step,
  menuItem,
  menuTrigger,
  calendarGrid,
  muted,
  panel,
  popoverSurface,
  sessionAvatar,
  portfolioSummary,
  quoteDetail,
  quoteRow,
  orderBookPanel,
  QUOTE_ROW_HEIGHT,
  rule,
  tableToolbar,
  themeButton,
  timeSalesPanel,
  watchlistHeader,
} from "./ui.js";

let themes = null;

async function currentOmarchyColors() {
  if (platform !== "linux") return "";
  try {
    const { current_colors } = await import("omarchy-theme");
    return current_colors();
  } catch (_) {
    return "";
  }
}

// How many Holdings rows the panel shows before the page scrolls instead of
// the panel growing. Any ceiling would do; this one keeps the summary and the
// allocation chart reachable above it without a scroll.
const HOLDINGS_VIEWPORT_ROWS = 10;
const WORKSPACE_LAYOUT_KEY = "workspace.layout.dock-panels-v1";
const WORKSPACE_LAYOUT_VERSION = 7;
const DETAIL_DOCK_WIDTH = 660;
const DEFAULT_DETAIL_DOCK_RATIO = 0.4;
const panelState = (name) => ({
  panel_name: `shell:com.longbridge.gpui-shell-example/${name}`,
  children: [],
  info: { panel: {} },
});
const tabState = (name) => ({
  panel_name: "TabPanel",
  children: [panelState(name)],
  info: { tabs: { active_index: 0 } },
});
const detailStackState = () => ({
  panel_name: "StackPanel",
  children: [tabState("quote-details"), tabState("chart"), tabState("market-detail")],
  info: { stack: { sizes: [220, 300, 0], axis: 1 } },
});
const DEFAULT_WORKSPACE_LAYOUT = Object.freeze({
  version: WORKSPACE_LAYOUT_VERSION,
  center: {
    panel_name: "StackPanel",
    children: [tabState("watchlist")],
    info: { stack: { sizes: [0], axis: 0 } },
  },
  right_dock: {
    panel: detailStackState(),
    placement: "right",
    size: DETAIL_DOCK_WIDTH,
    open: true,
  },
});

function defaultWorkspaceLayout() {
  const layout = JSON.parse(JSON.stringify(DEFAULT_WORKSPACE_LAYOUT));
  const viewportWidth = Number(window.viewport_size().width);
  if (viewportWidth > 0) {
    layout.right_dock.size =
      Math.max(0, viewportWidth - PANE_INSET * 2) * DEFAULT_DETAIL_DOCK_RATIO;
  }
  return clampWorkspaceLayout(layout);
}

function clampWorkspaceLayout(layout) {
  const viewportWidth = Number(window.viewport_size().width);
  if (viewportWidth > 0 && layout.right_dock) {
    layout.right_dock.size = Math.min(
      Number(layout.right_dock.size) || DETAIL_DOCK_WIDTH,
      Math.max(0, viewportWidth - PANE_INSET * 2 - WATCHLIST_MIN_WIDTH),
    );
  }
  return layout;
}

function panelWidthInTree(node, panelName, inheritedWidth) {
  if (!node || typeof node !== "object") return null;
  const bare = String(node.panel_name ?? "")
    .split("/")
    .at(-1);
  if (bare === panelName) return inheritedWidth;
  const children = Array.isArray(node.children) ? node.children : [];
  const stack = node.info?.stack;
  for (let index = 0; index < children.length; index += 1) {
    const width =
      stack?.axis === 0 && Number(stack.sizes?.[index]) > 0
        ? Number(stack.sizes[index])
        : inheritedWidth;
    const found = panelWidthInTree(children[index], panelName, width);
    if (found !== null) return found;
  }
  return null;
}
/**
 * How long the steps before the stream exists may take before the window says
 * so. Generous: it covers a token refresh, the watchlist read and the account
 * read, on a slow connection. What it is really for is the case that never
 * finishes at all -- see `armConnectDeadline`.
 */
const CONNECT_DEADLINE_MS = 30_000;

/**
 * Every card heading is this tall, so two side by side line up whatever is in
 * them. A 24px control in one and a line of text in the other is otherwise two
 * different heights.
 */
const CARD_HEADER_HEIGHT = 38;

/** How often the chart's live tail may cross the nested-view bridge. */
const CHART_PUBLISH_INTERVAL_MS = 500;

/** Which pane a change is worth repainting. See `syncWorkspacePanels`. */
const PANE_WATCHLIST = 1;
const PANE_QUOTE = 2;
const PANE_CHART = 4;
const PANE_MARKET = 8;
const PANE_DETAIL = PANE_QUOTE | PANE_CHART | PANE_MARKET;
const PANE_BOTH = PANE_WATCHLIST | PANE_DETAIL;

const EMPTY_CANDLES = Object.freeze([]);
const EMPTY_DETAIL_LEVELS = Object.freeze([]);
const EMPTY_DETAIL_TRADES = Object.freeze([]);
const CHART_CACHE_LIMIT = 16;
const CHART_LATEST_END = "latest";
const CANDLE_WINDOW_DAYS = Object.freeze({ "1m": 1, "5m": 5, "15m": 15, "1D": 190 });
const CHART_PERIODS = Object.freeze({
  "1m": PERIOD.ONE_MINUTE,
  "5m": PERIOD.FIVE_MINUTE,
  "15m": PERIOD.FIFTEEN_MINUTE,
  "1D": PERIOD.DAY,
});

function providerDayBucket(value) {
  const seconds = typeof value === "bigint" ? Number(value) : value;
  return Number.isSafeInteger(seconds) ? Math.floor(seconds / 86_400) : null;
}

function emptyDepthState(symbol = null) {
  return {
    symbol,
    status: symbol ? "loading" : "idle",
    asks: EMPTY_DETAIL_LEVELS,
    bids: EMPTY_DETAIL_LEVELS,
    error: "",
  };
}

function emptyTradesState(symbol = null) {
  return {
    symbol,
    status: symbol ? "loading" : "idle",
    trades: EMPTY_DETAIL_TRADES,
    error: "",
  };
}

/**
 * The height of the window's own title bar, and the room macOS needs on its
 * left for the traffic lights.
 *
 * `src/main.rs` carries the same height: it is what the host centers the
 * traffic lights against when it opens the window, before this script draws
 * anything, so a change here is a change there. The leading inset is this
 * script's alone -- the lights are drawn over the top-left corner of the
 * content, and only a platform that has them needs the room.
 */
const TITLE_BAR_HEIGHT = 44;
// `process.platform` is the host's name for the platform -- Rust's
// `std::env::consts::OS` -- and not Node's, so macOS is "macos" and never
// "darwin". Getting that wrong is silent: the inset falls back to the narrow
// one and the traffic lights are drawn straight over the logo.
const MACOS = platform === "macos";
// The lights start at the host's 15px inset and the three of them run about
// 54px, so they end near 69. This is not that number plus a hair: a control
// sitting a few pixels off the last light reads as a fourth one. The gap is
// wide enough to be a gap.
const TITLE_BAR_LEADING = MACOS ? 96 : 8;

/** The pages the title bar switches between. */
const PAGES = Object.freeze([
  { key: "watchlist", caption: "Watchlist" },
  { key: "portfolio", caption: "Portfolio" },
]);

/**
 * One duration, one curve, for every transition in the application.
 *
 * @param {import("gpui").Element} element @param {string} property
 */
function motion(element, property) {
  return element.transition(property, { duration: 150, easing: "ease-out" });
}

/**
 * The window is narrow enough to stack the Watchlist over the details rather
 * than beside them, in pixels of drawable width.
 *
 * A resizable group cannot wrap, so this used to be impossible to answer and
 * the panes just shrank. `window.viewport_size()` is legal from `render`,
 * which is where the question is asked.
 */
const NARROW_VIEWPORT = 960;
const COMPACT_WATCHLIST_WIDTH = 620;

/** How many holdings one page of the Holdings panel shows. */

/**
 * The application keymap.
 *
 * Chords are bound to *actions*, not to handlers: the keymap says which chord
 * means `workspace::reconnect`, `on_action` says what that does, and the
 * session menu dispatches the same name through `window.dispatch_action`
 * without pretending to be a keyboard. Application commands use `ctrl` on
 * Linux and the conventional `cmd` modifier on macOS.
 *
 * @type {readonly import("gpui").KeyBinding[]}
 */
const PRIMARY_MODIFIER = MACOS ? "cmd" : "ctrl";

export const KEY_BINDINGS = Object.freeze([
  { keystroke: `${PRIMARY_MODIFIER}-1`, action: "workspace::watchlist", context: "Workspace" },
  { keystroke: `${PRIMARY_MODIFIER}-2`, action: "workspace::portfolio", context: "Workspace" },
  { keystroke: `${PRIMARY_MODIFIER}-r`, action: "workspace::reconnect", context: "Workspace" },
  { keystroke: `${PRIMARY_MODIFIER}-t`, action: "workspace::toggle-theme", context: "Workspace" },
  {
    keystroke: `${PRIMARY_MODIFIER}-shift-f`,
    action: "workspace::toggle-fullscreen",
    context: "Workspace",
  },
  { keystroke: "alt-down", action: "watchlist::next", context: "Workspace" },
  { keystroke: "alt-up", action: "watchlist::previous", context: "Workspace" },
  { keystroke: "escape", action: "workspace::dismiss", context: "Workspace" },
]);

/**
 * How a chord is written for a reader, as opposed to how it is bound.
 *
 * A keystroke such as `"ctrl-shift-f"` is the keymap's declaration, not what a
 * person reads. The display
 * form is one grammar: modifiers in a fixed order, spaces around every `+`, and
 * one name per key rather than whatever the binding happened to abbreviate.
 *
 * Fixed order rather than the order the binding was written in, so
 * `ctrl-shift-f` and a hypothetical `shift-ctrl-f` read the same.
 */
const MODIFIER_ORDER = Object.freeze(["cmd", "ctrl", "shift", "alt"]);
const MODIFIER_NAMES = Object.freeze({ cmd: "Cmd", ctrl: "Ctrl", shift: "Shift", alt: "Alt" });
// One name per key, so nothing in the interface says `Enter` in one place and
// `Return` in another, or `Up` where its neighbour says `Arrow Down`.
const KEY_NAMES = Object.freeze({
  escape: "Escape",
  enter: "Return",
  up: "Arrow Up",
  down: "Arrow Down",
  left: "Arrow Left",
  right: "Arrow Right",
  space: "Space",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
});

/** @param {string} keystroke A keymap chord, e.g. `"ctrl-shift-f"`. */
export function chordLabel(keystroke) {
  const parts = String(keystroke).split("-");
  const key = parts.pop() ?? "";
  const modifiers = MODIFIER_ORDER.filter((name) => parts.includes(name)).map(
    (name) => MODIFIER_NAMES[name],
  );
  const named =
    KEY_NAMES[key] ??
    (key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1));
  return [...modifiers, named].join(" + ");
}

/**
 * What each bound action does, in the words the footer rail shows.
 *
 * Keyed by action rather than by chord, because the chord is the keymap's to
 * decide and this is only the caption beside it: rebinding `ctrl-r` changes what
 * the rail draws without touching this table, and adding a caption for an
 * action nothing binds adds nothing to the rail at all.
 */
const SHORTCUT_CAPTIONS = Object.freeze({
  "workspace::watchlist": "Watchlist",
  "workspace::portfolio": "Portfolio",
  "workspace::reconnect": "Reconnect",
  "workspace::toggle-theme": "Switch theme",
  "workspace::toggle-fullscreen": "Full screen",
  "watchlist::next": "Next row",
  "watchlist::previous": "Previous row",
  "workspace::dismiss": "Dismiss",
});

/** `YYYY-MM-DD` in local time, which is the spelling `CalendarState` uses. */
function calendarDay(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** @param {string} day @param {number} days */
function shiftDay(day, days) {
  const shifted = new Date(`${day}T00:00:00`);
  shifted.setDate(shifted.getDate() + days);
  return calendarDay(shifted);
}

/** @param {unknown} value */
function stringValue(value) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "--";
}

/** @param {unknown} value */
function firstRecord(value) {
  if (Array.isArray(value)) return value[0] ?? null;
  if (!value || typeof value !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (value);
  const data = record.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return firstRecord(data);
  }
  for (const key of ["list", "accounts"]) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate[0] ?? null;
  }
  return record;
}

/** @param {unknown} value @returns {LongbridgeHoldingRow[]} */
function normalizeHoldings(value) {
  const root =
    value && typeof value === "object" ? /** @type {Record<string, unknown>} */ (value) : {};
  const data =
    root.data && typeof root.data === "object" && !Array.isArray(root.data)
      ? /** @type {Record<string, unknown>} */ (root.data)
      : root;
  const outer = Array.isArray(value)
    ? value
    : ([data.list, data.stock_info, data.stock_positions].find(Array.isArray) ?? []);
  const rows = outer.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = /** @type {Record<string, unknown>} */ (entry);
    return Array.isArray(record.stock_info) ? record.stock_info : [record];
  });
  return rows
    .map((entry) => {
      const holding = /** @type {Record<string, unknown>} */ (entry);
      return {
        symbol: stringValue(holding.symbol),
        name: stringValue(holding.symbol_name ?? holding.name),
        quantity: stringValue(holding.quantity),
        available: stringValue(holding.available_quantity ?? holding.available),
        costPrice: stringValue(holding.cost_price ?? holding.costPrice),
        currency: stringValue(holding.currency),
      };
    })
    .filter((holding) => holding.symbol !== "--");
}

function storedTokens() {
  try {
    return loadTokens();
  } catch (_) {
    return null;
  }
}

export default class LongbridgeApp extends View {
  /** @param {import("gpui-shell").Props | undefined} _props @param {import("gpui").AsyncContext} cx */
  init(_props, cx) {
    holdContext(cx);
    this.followsSystemTheme = false;
    this.omarchyThemeSource = "";
    this.themeSyncPending = false;
    cx.spawn(async (cx) => {
      const themeSource = await readFile("theme.json", "utf8");
      themes = JSON.parse(themeSource);
      const omarchySource = await currentOmarchyColors();
      const fallback = themes[window.appearance()];
      const systemTheme = omarchyTheme(omarchySource, fallback);
      setOmarchyAvatarColors(omarchyBaseColors(omarchySource));
      setOmarchyMarketColors(omarchyMarketColors(omarchySource));
      this.followsSystemTheme = systemTheme !== null;
      this.omarchyThemeSource = systemTheme ? omarchySource : "";
      set_theme(systemTheme ?? fallback);
      this.chartThemeRevision += 1;
      this.syncPriceChartView();
      this.redraw(cx);
    });
    this.instruments = [];
    this.quotes = [];
    this.portfolioQuotes = [];
    this.selectedSymbol = null;
    /** @type {LongbridgePage} */
    this.page = "watchlist";
    this.hasStoredTokens = Boolean(storedTokens());
    this.status = { state: this.hasStoredTokens ? "saved session" : "offline" };
    this.authorization = null;
    this.account = null;
    this.fxRates = new Map([["USD", 1]]);
    /** @type {LongbridgeHoldingRow[]} */
    this.holdings = [];
    this.error = "";
    this.streamError = "";
    this.stream = null;
    this.streamGeneration = 0;
    this.connectedToken = null;
    this.lastTick = Date.now();
    this.quotePulse = 1;
    // Set when a quote changed the selected instrument's candles, cleared when
    // the coalesced repaint publishes them. See `scheduleRedraw`.
    this.chartDirty = false;
    this.repaint = null;
    /** The pending deferred chart publish, if one is already queued. */
    this.chartPublish = null;
    /** When the chart last crossed the bridge, for the live tail's rate limit. */
    this.chartPublishedAt = 0;
    this.dirtyPanes = 0;
    /** Pushes that have arrived but not yet been merged. See `drainQuotes`. */
    this.pendingQuotes = [];
    // Off unless asked for. The rail names every binding and the row under it
    // reports the window's own measurements -- both are for learning the
    // application and for reading a bug report, and neither is worth four
    // lines of a market terminal once you know them.
    this.statusBarVisible = false;
    this.fpsVisible = loadFpsVisible();
    this.candleCache = new Map();
    this.chartState = { symbol: null, state: "idle" };
    this.chartGeneration = 0;
    this.chartThemeRevision = 0;
    this.initChartModeState();
    this.initDetailMarketState();
    this.initInteractionState();
    this.initKeyboard(cx);
    this.initChartCalendar(cx);
    this.initPriceChartView(cx);
    this.initWorkspaceDock(cx);
    this.clock = cx.timer.every(1_000, (cx) => {
      this.syncSystemTheme(cx);
      this.lastTick = Date.now();
      this.quotes = sortLikeTerminal(this.quotes, this.lastTick);
      this.redraw(cx);
    });
    if (this.hasStoredTokens) this.resume(cx);
  }

  /** @param {import("gpui").Context} cx */
  syncSystemTheme(cx) {
    if (!themes || this.themeSyncPending || platform !== "linux") return;
    this.themeSyncPending = true;
    cx.spawn(async (cx) => {
      try {
        const source = await currentOmarchyColors();
        if (!source || source === this.omarchyThemeSource) return;
        const theme = omarchyTheme(source, themes[window.appearance()]);
        if (!theme) return;
        setOmarchyAvatarColors(omarchyBaseColors(source));
        setOmarchyMarketColors(omarchyMarketColors(source));
        this.followsSystemTheme = true;
        this.omarchyThemeSource = source;
        set_theme(theme);
        this.chartThemeRevision += 1;
        this.syncPriceChartView();
        this.redraw(cx);
      } finally {
        this.themeSyncPending = false;
      }
    });
  }

  /**
   * Installs the keymap and the focus target the actions arrive through.
   *
   * An action is dispatched down the window's focus path, so a workspace that
   * nothing inside it has focused hears nothing. The root tracks a handle of
   * its own and takes the keyboard once, which also gives every chord a place
   * to land back on after a popover hands focus over and takes it away again.
   *
   * @param {import("gpui").AsyncContext} cx
   */
  initKeyboard(cx) {
    this.workspaceFocus = cx.focus_handle();
    /** The last chord the workspace saw, for the footer's readout. */
    this.lastKeystroke = "";
    this.keyDown = false;
    this.keyHeld = false;
    this.pointerDown = false;
    this.diagnosticsOpen = false;
    this.boundKeys = cx.bind_keys([...KEY_BINDINGS]);
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      this.workspaceFocus.focus();
      this.redraw(cx);
    });
  }

  /**
   * The retained month the chart's date picker reads.
   *
   * `CalendarState` is retained state like `InputState`: it is created once
   * here and never in a render. Base's `Calendar` element is deliberately not
   * bound — it would cross into JavaScript once per cell from inside the
   * layout pass — so this answers the grid and `calendarGrid` draws it.
   *
   * @param {import("gpui").AsyncContext} cx
   */
  initChartCalendar(cx) {
    this.chartCalendar = CalendarState.new();
    /** The chart's last day; `null` means "up to today". */
    this.chartEndDate = null;
    this.calendarOpen = false;
    this.chartCalendar.on("change", (date, cx) => {
      const day = typeof date === "string" ? date : null;
      if (!day || day === this.chartEndDate) return;
      this.chartEndDate = day;
      this.loadSelectedChart(cx);
      this.redraw(cx);
    });
  }

  /** Initializes session-only chart selection and its bounded response cache. */
  initChartModeState() {
    // This deliberately never reads or writes localStorage: a chosen chart
    // mode belongs to this running application session, not the login session.
    this.chartMode = "5D";
    this.chartCache = new Map();
  }

  /** @returns {keyof typeof CHART_MODES} */
  activeChartMode() {
    return CHART_MODES[this.chartMode] ? this.chartMode : "5D";
  }

  chartIdentityEndDate() {
    return this.chartEndDate ?? CHART_LATEST_END;
  }

  currentChartIdentity(symbol = this.selectedSymbol) {
    return symbol
      ? chartRequestIdentity(symbol, this.activeChartMode(), this.chartIdentityEndDate())
      : null;
  }

  cachedChartSeries(symbol = this.selectedSymbol) {
    const identity = this.currentChartIdentity(symbol);
    if (!identity) return EMPTY_CANDLES;
    if (this.chartCache?.has(identity)) {
      const cached = this.chartCache.get(identity);
      // Map insertion order is the LRU order. A completed response and a cache
      // hit both become most-recently used without rebuilding its series.
      this.chartCache.delete(identity);
      this.chartCache.set(identity, cached);
      return cached;
    }
    // Older retained-child fixtures seed the pre-mode cache directly. Keeping
    // this read-only compatibility path lets the state migration land before
    // the retained UI changes, without allowing it to mask a new mode cache.
    return this.activeChartMode() === "5D"
      ? (this.candleCache?.get(symbol) ?? EMPTY_CANDLES)
      : EMPTY_CANDLES;
  }

  hasCachedChartSeries(symbol = this.selectedSymbol) {
    const identity = this.currentChartIdentity(symbol);
    return Boolean(
      identity &&
      (this.chartCache?.has(identity) ||
        (this.activeChartMode() === "5D" && this.candleCache?.has(symbol))),
    );
  }

  cacheChartSeries(identity, candles) {
    if (!this.chartCache) this.chartCache = new Map();
    this.chartCache.delete(identity);
    this.chartCache.set(identity, candles);
    while (this.chartCache.size > CHART_CACHE_LIMIT)
      this.chartCache.delete(this.chartCache.keys().next().value);
  }

  setChartMode(mode, cx) {
    if (!CHART_MODES[mode] || mode === this.activeChartMode()) return;
    this.chartMode = mode;
    this.loadSelectedChart(cx);
    this.redraw(cx);
  }

  /** Invalidates only the currently visible request from the session cache. */
  invalidateCurrentChartCache() {
    const identity = this.currentChartIdentity();
    if (identity) this.chartCache?.delete(identity);
    if (this.activeChartMode() === "5D") this.candleCache?.delete(this.selectedSymbol);
  }

  chartRequestFor(symbol, mode, endDate = this.chartIdentityEndDate()) {
    const selected = CHART_MODES[mode];
    if (!selected) throw new TypeError(`unknown chart mode ${mode}`);
    // An omitted end date is the explicit "current market day" boundary. Any
    // date the user selected, including today, must go through dated history so
    // a command-18 response cannot be cached under a historical identity.
    if (mode === "intraday" && endDate === CHART_LATEST_END) {
      return {
        kind: "intraday",
        params: { symbol, tradeSession: TRADE_SESSION.ALL },
      };
    }
    const requestEnd = endDate === CHART_LATEST_END ? calendarDay(new Date()) : endDate;
    const days = mode === "intraday" ? 0 : mode === "5D" ? 14 : CANDLE_WINDOW_DAYS[mode];
    const startDay = days === 0 ? requestEnd : shiftDay(requestEnd, -days);
    const compact = (day) => day.replaceAll("-", "");
    return {
      kind: "candlesticks",
      params: {
        symbol,
        period: CHART_PERIODS[selected.period],
        startDate: compact(startDay),
        endDate: compact(requestEnd),
        tradeSession: mode === "intraday" ? TRADE_SESSION.ALL : TRADE_SESSION.NORMAL,
      },
    };
  }

  /**
   * Creates the retained chart entity from lifecycle code, never from render.
   *
   * @param {import("gpui").Context} cx
   */
  initPriceChartView(cx) {
    const props = this.nextPriceChartProps();
    this.publishedPriceChartProps = props;
    this.priceChart = cx.new(PriceChartView, props);
  }

  /** The complete immutable input snapshot the child needs to render the chart. */
  chartProps() {
    const symbol = this.selectedSymbol ?? "";
    const mode = this.activeChartMode();
    const candles = symbol ? this.cachedChartSeries(symbol) : EMPTY_CANDLES;
    const state =
      this.chartState.symbol === symbol ? this.chartState.state : symbol ? "loading" : "idle";
    const chartSeries =
      mode === "intraday"
        ? compactIntradaySeriesForView(prepareIntradaySeries(candles), PRICE_CHART_LAYOUT)
        : mode === "5D"
          ? compactFiveDaySeries(prepareFiveDaySeries(symbol, candles), PRICE_CHART_LAYOUT)
          : prepareCandleSeries(windowCandles(candles));
    return {
      symbol,
      mode,
      chartSeries,
      state,
      layout: PRICE_CHART_LAYOUT,
      themeRevision: this.chartThemeRevision,
    };
  }

  nextPriceChartProps() {
    return this.chartProps();
  }

  /** Pushes props only when a chart input changed, and only from mutation sites. */
  syncPriceChartView() {
    if (!this.priceChart) return;
    const next = this.nextPriceChartProps();
    const previous = this.publishedPriceChartProps;
    if (
      previous?.symbol === next.symbol &&
      previous?.mode === next.mode &&
      previous?.chartSeries === next.chartSeries &&
      previous?.state === next.state &&
      previous?.layout === next.layout &&
      previous?.themeRevision === next.themeRevision
    ) {
      return;
    }
    this.publishedPriceChartProps = next;
    this.priceChart.set_props(next);
  }

  /**
   * Creates the workspace dock and its Watchlist plus three detail panels.
   *
   * The layout is the user's, not the application's: which pane is where, how
   * wide the watchlist is, whether it is collapsed. So it lives in a retained
   * `DockArea` and is written back to storage whenever it changes, rather than
   * being described afresh on every render — a dock rebuilt from a description
   * would undo every drag the moment anything else redrew.
   *
   * @param {import("gpui").Context} cx
   */
  /**
   * Repaints the two panes.
   *
   * A dock panel is not a child of this view's description — the dock area
   * holds it — so `cx.notify()` here repaints the header, the footer and the
   * chrome, and reaches neither pane. This is the other half of that: it hands
   * each panel a targeted notification, because what the call is for is a
   * repaint of shared state rather than a new value.
   *
   * @param {import("gpui").Context | import("gpui").AsyncContext} cx
   */
  syncWorkspacePanels(cx) {
    // Each `set_props` crosses the nested-view bridge and rebuilds that pane's
    // whole description, so publishing to both on every repaint costs twice
    // what the change was worth -- a quote for an instrument nobody selected
    // moves a row in the watchlist and nothing at all in the details. On the
    // resizable workspace this view drew both panes itself and one `notify`
    // covered them; the bridge is what makes the difference worth tracking.
    const panes = this.dirtyPanes;
    this.dirtyPanes = 0;
    // These panes read the shared application they retained during `init`.
    // `cx.notify(entity)` is GPUI's targeted invalidation: unlike `set_props`,
    // it does not run a child update transaction or checkpoint every object
    // reachable through that application reference.
    void panes;
    void cx;
  }

  /**
   * Merges everything that arrived since the last repaint, in one pass.
   *
   * Order is preserved, so `mergeQuote` refuses an out-of-order push here
   * exactly as it would have one arriving on its own.
   */
  drainQuotes() {
    if (this.pendingQuotes.length === 0) return;
    const arrived = this.pendingQuotes;
    this.pendingQuotes = [];
    const receivedAt = Date.now();
    this.quotes = applyQuotes(this.quotes, arrived, receivedAt);
    this.portfolioQuotes = applyQuotes(this.portfolioQuotes, arrived, receivedAt);
  }

  /**
   * Repaints soon, and at most once however many callers ask in between.
   *
   * A quote is not a reason to repaint on its own. They arrive in bursts --
   * every instrument in a live Hong Kong and A-share watchlist, several times a
   * second each -- and a repaint is two `set_props` and a notify. One of those
   * per quote is more than a market terminal needs and more than a person can
   * read.
   *
   * So a quote sets state and asks for a repaint, and this decides when: the
   * first ask schedules one and the rest of the burst ride on it. A tenth of a
   * second is under what reads as delay and far over the rate the pushes arrive
   * at, which is the point -- the cost stops scaling with how chatty the market
   * is.
   *
   * @param {import("gpui").Context} cx
   */
  scheduleRedraw(cx, panes = PANE_BOTH) {
    this.dirtyPanes |= panes;
    if (this.repaint) return;
    this.repaint = cx.timer.after(100, (cx) => {
      this.repaint = null;
      const pendingPanes = this.dirtyPanes || PANE_BOTH;
      this.dirtyPanes = 0;
      this.drainQuotes();
      // The chart's live tail, at a rate a chart can be read at.
      //
      // `mergeLiveQuote` answers with a new series for every push, so the
      // identity guard in `syncPriceChartView` never holds on this path and
      // every tick would hand the whole window across the nested-view bridge.
      // Crossing it is not the cost -- journalling is: the shell snapshots
      // every object reachable from the child before running its `update`, and
      // what is reachable from this one is five sessions of candles. Twice a
      // second is well under what reads as live on a five-day chart.
      if (this.chartDirty && Date.now() - this.chartPublishedAt >= CHART_PUBLISH_INTERVAL_MS) {
        this.chartDirty = false;
        this.chartPublishedAt = Date.now();
        this.syncPriceChartView();
      }
      this.redraw(cx, pendingPanes);
    });
  }

  /**
   * What every mutation site calls: repaint this view, and repaint the panes.
   *
   * One funnel rather than a `cx.notify()` at each site, because after the
   * workspace became a dock those are two different requests and forgetting the
   * second one is invisible — the header updates and the table does not.
   *
   * @param {import("gpui").Context} cx
   */
  redraw(cx, panes = PANE_BOTH) {
    this.paneRevisions ??= { watchlist: 0, quote: 0, chart: 0, market: 0 };
    if (panes & PANE_WATCHLIST) this.paneRevisions.watchlist += 1;
    if (panes & PANE_QUOTE) this.paneRevisions.quote += 1;
    if (panes & PANE_CHART) this.paneRevisions.chart += 1;
    if (panes & PANE_MARKET) this.paneRevisions.market += 1;
    if (panes !== PANE_MARKET) cx.notify();
  }

  releasePriceChartView() {
    if (!this.priceChart) return;
    this.priceChart.release();
    this.priceChart = null;
    this.publishedPriceChartProps = null;
  }

  /** Initializes data which belongs only to the selected instrument's detail panels. */
  initDetailMarketState() {
    this.depthCache = new Map();
    this.depthState = emptyDepthState();
    this.tradesState = emptyTradesState();
    this.detailMarketGeneration = 0;
  }

  /** Invalidates all in-flight detail work and clears both panel states. */
  clearDetailMarket() {
    this.detailMarketGeneration += 1;
    this.depthState = emptyDepthState();
    this.tradesState = emptyTradesState();
  }

  /**
   * Changes the selected detail instrument without touching the chart's retained props.
   *
   * @param {string | null} symbol
   * @param {import("gpui").Context | import("gpui").AsyncContext} cx
   */
  selectDetailMarket(symbol, cx) {
    const selected = typeof symbol === "string" && symbol ? symbol : null;
    const generation = ++this.detailMarketGeneration;
    this.selectedSymbol = selected;
    const cachedDepth = selected ? this.depthCache?.get(selected) : null;
    this.depthState = cachedDepth ?? emptyDepthState(selected);
    this.tradesState = emptyTradesState(selected);
    this.redraw(cx, PANE_DETAIL);

    const stream = this.stream;
    if (!stream || typeof stream.selectDetailSymbol !== "function") return Promise.resolve();
    try {
      return Promise.resolve(stream.selectDetailSymbol(selected, generation)).catch((error) =>
        this.receiveDetailError({ symbol: selected, generation, error }, cx),
      );
    } catch (error) {
      this.receiveDetailError({ symbol: selected, generation, error }, cx);
      return Promise.resolve();
    }
  }

  /**
   * @param {unknown} detail
   * @param {import("gpui").Context | import("gpui").AsyncContext} cx
   */
  receiveDetailError(detail, cx) {
    if (
      !detail ||
      typeof detail !== "object" ||
      detail.symbol !== this.selectedSymbol ||
      detail.generation !== this.detailMarketGeneration
    ) {
      return;
    }
    const message =
      detail.error instanceof Error ? detail.error.message : String(detail.error ?? "");
    this.depthState = { ...this.depthState, status: "error", error: message };
    this.tradesState = { ...this.tradesState, status: "error", error: message };
    this.scheduleRedraw(cx, PANE_MARKET);
  }

  /**
   * @param {unknown} depth
   * @param {import("gpui").Context | import("gpui").AsyncContext} cx
   * @param {number} generation
   */
  receiveDepth(depth, cx, generation) {
    if (
      !depth ||
      typeof depth !== "object" ||
      generation !== this.detailMarketGeneration ||
      depth.symbol !== this.selectedSymbol ||
      this.depthState.symbol !== this.selectedSymbol
    ) {
      return;
    }
    const normalized = normalizeDepth(depth);
    const hasDepth = [...normalized.asks, ...normalized.bids].some(validDepthLevel);
    this.depthCache ??= new Map();
    if (hasDepth) {
      this.depthState = Object.freeze({
        symbol: normalized.symbol,
        status: "ready",
        asks: normalized.asks,
        bids: normalized.bids,
        error: "",
      });
      this.depthCache.set(normalized.symbol, this.depthState);
    } else {
      this.depthState = this.depthCache.get(normalized.symbol) ?? {
        symbol: normalized.symbol,
        status: "ready",
        asks: normalized.asks,
        bids: normalized.bids,
        error: "",
      };
    }
    this.scheduleRedraw(cx, PANE_MARKET);
  }

  /**
   * @param {unknown} payload
   * @param {import("gpui").Context | import("gpui").AsyncContext} cx
   * @param {number} generation
   */
  receiveTrades(payload, cx, generation) {
    if (
      !payload ||
      typeof payload !== "object" ||
      generation !== this.detailMarketGeneration ||
      payload.symbol !== this.selectedSymbol ||
      this.tradesState.symbol !== this.selectedSymbol
    ) {
      return;
    }
    const trades = Array.isArray(payload.trades) ? payload.trades : EMPTY_DETAIL_TRADES;
    this.tradesState = {
      symbol: this.selectedSymbol,
      status: "ready",
      trades: mergeTrades(this.tradesState.trades, trades),
      error: "",
    };
    this.scheduleRedraw(cx, PANE_MARKET);
  }

  /**
   * The state a render reaches for unconditionally: both controlled popovers,
   * and the retained text state behind the two list filters.
   *
   * Its own method because a view that skipped it draws nothing at all --
   * `Input.new(undefined)` throws and takes the whole tree with it -- and a
   * probe that replaces `init` wholesale would otherwise do exactly that.
   *
   * `InputState.new()` needs a live host call, so this belongs in an `init` or
   * an event handler, never in a render. The query is mirrored onto the view
   * because render reads it every frame and reading it off the handle would
   * put a host call on the frame path. The popovers are controlled: the shell
   * reports every open and close through `on_open_change`, and these two
   * fields are where the answer lives.
   */
  initInteractionState() {
    this.userMenuOpen = false;
    this.allocationHelpOpen = false;
    /** Which stock-detail sections are expanded. */
    this.detailSections = { about: false };
    this.paneRevisions = { watchlist: 0, quote: 0, chart: 0, market: 0 };
    this.watchlistQuery = "";
    this.holdingsQuery = "";
    this.watchlistFilter = InputState.new({ placeholder: "Filter watchlist" });
    this.watchlistFilter.on("change", (_event, cx) => {
      this.watchlistQuery = this.watchlistFilter.value();
      this.redraw(cx);
    });
    this.holdingsFilter = InputState.new({ placeholder: "Filter holdings" });
    this.holdingsFilter.on("change", (_event, cx) => {
      this.holdingsQuery = this.holdingsFilter.value();
      this.redraw(cx);
    });
  }

  initWorkspaceDock(_cx) {
    holdWorkspaceApp(this);
    DockArea.register_panel("watchlist", WatchlistPanel);
    DockArea.register_panel("quote-details", QuoteDetailsPanel);
    DockArea.register_panel("chart", ChartPanel);
    DockArea.register_panel("market-detail", MarketDetailPanel);
    this.workspaceDock = DockArea.new("longbridge-workspace", {
      version: WORKSPACE_LAYOUT_VERSION,
    });
    let layout = defaultWorkspaceLayout();
    try {
      const saved = localStorage.getItem(WORKSPACE_LAYOUT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.version === WORKSPACE_LAYOUT_VERSION) layout = parsed;
      }
    } catch {}
    layout = clampWorkspaceLayout(layout);
    this.workspaceLayout = layout;
    this.workspaceDock.load(layout);
    this.workspaceDock.on("layout_changed", () => {
      try {
        this.workspaceLayout = this.workspaceDock.dump();
        const persisted = JSON.parse(JSON.stringify(this.workspaceLayout));
        if (persisted.right_dock) persisted.right_dock.open = true;
        localStorage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify(persisted));
      } catch {}
    });
  }

  /** Reconciles a native Dock drag with the Watchlist's application-level minimum. */
  queueWorkspaceDockReconcile(cx) {
    if (!this.workspaceDock || this.workspaceDockReconcileQueued) return;
    this.workspaceDockReconcileQueued = true;
    cx.timer.after(0, (cx) => {
      this.workspaceDockReconcileQueued = false;
      const viewportWidth = Number(window.viewport_size().width);
      const maximum = Math.max(0, viewportWidth - PANE_INSET * 2 - WATCHLIST_MIN_WIDTH);
      const current = Number(this.workspaceDock.dock_size("right")) || 0;
      if (this.workspaceDock.is_dock_open("right") && current > maximum) {
        this.workspaceDock.set_dock_size("right", maximum);
      } else {
        this.workspaceLayout = this.workspaceDock.dump();
        try {
          const persisted = JSON.parse(JSON.stringify(this.workspaceLayout));
          if (persisted.right_dock) persisted.right_dock.open = true;
          localStorage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify(persisted));
        } catch {}
      }
      this.redraw(cx, 0);
    });
  }

  /** Restores the four independent panels to their documented default Dock layout. */
  resetWorkspace(cx) {
    const layout = defaultWorkspaceLayout();
    try {
      localStorage.removeItem(WORKSPACE_LAYOUT_KEY);
    } catch {}
    this.workspaceLayout = layout;
    this.workspaceDock.load(layout);
    this.redraw(cx);
  }

  /**
   * Bounds how long the connect sequence may sit in a transient state.
   *
   * `connect` cannot rely on its own `catch`. The sandbox interrupts a script
   * that overruns its execution budget, and that interrupt is not catchable --
   * it unwinds past every `catch` on the way out, `resume`'s included. A
   * sequence cut down that way leaves `status` at whatever step it had reached
   * and nothing else in this view can tell: the header says "Loading
   * watchlist" and goes on saying it for as long as the window is open, which
   * is what a stalled start looks like from the outside.
   *
   * `quote_stream.js` bounds its own handshake for exactly this reason. This is
   * the same guard one layer out, over the steps before the stream exists.
   *
   * @param {import("gpui").Context} cx
   * @param {number} generation
   */
  armConnectDeadline(cx, generation) {
    this.clearConnectDeadline();
    this.connectDeadline = cx.timer.after(CONNECT_DEADLINE_MS, (cx) => {
      this.connectDeadline = null;
      // A later attempt owns the state now, and a stream that reached
      // `connected` needs no rescue.
      if (generation !== this.streamGeneration) return;
      if (this.status.state === "connected") return;
      // Named from the step it was on, because "it stopped at Loading
      // watchlist" and "it stopped at Loading snapshot" send you to different
      // places.
      const stalled = streamStatusSummary(this.status);
      this.status = { state: "error" };
      this.error =
        `Connecting stopped at "${stalled}" after ` +
        `${Math.round(CONNECT_DEADLINE_MS / 1000)}s. Retry, or sign in again.`;
      this.redraw(cx);
    });
  }

  clearConnectDeadline() {
    this.connectDeadline = null;
  }

  /** @param {import("gpui").Context} cx */
  resume(cx) {
    this.status = { state: "restoring_token" };
    this.error = "";
    this.streamError = "";
    this.redraw(cx);
    cx.spawn(async (cx) => {
      try {
        await this.connect(await accessToken(), cx);
      } catch (error) {
        this.clearConnectDeadline();
        this.status = { state: "error" };
        this.error = error instanceof Error ? error.message : String(error);
        this.redraw(cx);
      }
    });
  }

  /** @param {import("gpui").Context} cx */
  signIn(cx) {
    if (this.authorization) return;
    this.status = { state: "authorizing" };
    this.error = "";
    this.redraw(cx);
    cx.spawn(async (cx) => {
      try {
        const authorization = await beginDeviceAuthorization();
        this.authorization = authorization;
        // The page opens here rather than waiting to be clicked. The address is
        // only known once the device code exists, which is what a second click
        // would have been waiting for — and it is not an address anyone reads,
        // it is one they approve on.
        try {
          cx.open_url(authorization.verificationUri);
        } catch (error) {
          // The browser is a convenience: "Copy link" is still on the card, and
          // an authorization that cannot be opened here is not one that failed.
          // It is said out loud, though. A bare catch here swallowed a missing
          // import once, and the symptom was a browser that simply never
          // opened, with nothing anywhere to say why.
          console.warn(`could not open the authorization page: ${error}`);
        }
        this.redraw(cx);
        const tokens = await pollDeviceAuthorization(authorization);
        this.hasStoredTokens = true;
        this.authorization = null;
        await this.connect(tokens.accessToken, cx);
      } catch (error) {
        this.authorization = null;
        this.status = { state: "error" };
        this.error = error instanceof Error ? error.message : String(error);
        this.redraw(cx);
      }
    });
  }

  /** @param {string} token @param {import("gpui").AsyncContext} cx */
  async connect(token, cx) {
    this.connectedToken = token;
    const generation = ++this.streamGeneration;
    // Stopping the old stream rejects its pending candlestick query. Make that
    // request stale before awaiting stop, so its catch cannot publish into the
    // reconnecting chart while the replacement watchlist is still loading.
    this.chartGeneration += 1;
    this.clearDetailMarket();
    const previous = this.stream;
    this.stream = null;
    if (previous) await previous.stop();
    if (generation !== this.streamGeneration) return;
    this.status = { state: "loading_watchlist" };
    this.armConnectDeadline(cx, generation);
    this.redraw(cx);

    const instruments = watchlistInstruments(await get("/v1/watchlist/groups"));
    if (generation !== this.streamGeneration) return;
    this.instruments = instruments;
    this.quotes = sortLikeTerminal(initialQuotes(instruments), Date.now());
    this.selectedSymbol = instruments[0]?.symbol ?? null;
    if (!this.priceChart) this.initPriceChartView(cx);
    this.syncPriceChartView();
    // The primary workspace is usable as soon as Watchlist has loaded. Asset
    // reads are a separate, slower boundary and must not leave navigation in a
    // misleading global Connecting state.
    this.status = { state: "connected" };
    this.clearConnectDeadline();
    this.redraw(cx);
    await this.refreshPortfolio();
    if (generation !== this.streamGeneration) return;
    const symbols = [
      ...new Set([
        ...instruments.map((instrument) => instrument.symbol),
        ...this.holdings.map((holding) => holding.symbol),
      ]),
    ];
    if (symbols.length === 0) {
      this.status = { state: "connected" };
      this.redraw(cx);
      this.loadPortfolio(cx);
      return;
    }

    let stream;
    // The stream outlives this call, and so must the context its callbacks
    // notify through: `cx` here is the task's `AsyncContext`, which is the
    // flavour that may be held across an await.
    stream = createQuoteStream({
      accessToken: token,
      symbols,
      onQuote: (quote) => {
        if (generation === this.streamGeneration && this.stream === stream)
          this.receiveQuote(quote, cx);
      },
      onDepth: (depth, detailGeneration) => {
        if (generation === this.streamGeneration && this.stream === stream)
          this.receiveDepth(depth, cx, detailGeneration);
      },
      onTrades: (trades, detailGeneration) => {
        if (generation === this.streamGeneration && this.stream === stream)
          this.receiveTrades(trades, cx, detailGeneration);
      },
      onDetailError: (detail) => {
        if (generation === this.streamGeneration && this.stream === stream)
          this.receiveDetailError(detail, cx);
      },
      onStatus: (status) => {
        if (generation === this.streamGeneration && this.stream === stream)
          this.receiveStatus(status, cx);
      },
    });
    this.stream = stream;
    this.selectDetailMarket(this.selectedSymbol, cx);
    await stream.start();
    if (generation !== this.streamGeneration) {
      await stream.stop();
      return;
    }
    this.loadSelectedChart(cx);
  }

  /** @param {unknown} quote @param {import("gpui").AsyncContext} cx */
  receiveQuote(quote, cx) {
    let selected = false;
    // Deliberately no re-sort here. `sortLikeTerminal` ranks a row from trade
    // session counts taken across the whole list, so running it per quote made
    // the connect burst -- the whole watchlist twice over, snapshot plus
    // isFirstPush, in one synchronous run -- cost seconds and overrun the
    // sandbox's task budget, which unwound the stream before it could reach
    // `connected`. The one-second clock already re-sorts.
    // Buffered, not applied. A connection opens with every instrument twice
    // over -- the snapshot and then the first push -- in one synchronous run,
    // and publishing a new list per quote copies the whole watchlist each time.
    // That burst is what overruns the sandbox's budget, and the interrupt is
    // not catchable, so it takes the rest of the run with it. Held here and
    // merged in one pass by the repaint that was already being coalesced.
    this.pendingQuotes.push(quote);
    if (quote && typeof quote === "object" && quote.symbol === this.selectedSymbol) {
      const identity = this.currentChartIdentity();
      const candles = this.cachedChartSeries();
      if (this.hasCachedChartSeries() && candles) {
        const activeQuote = this.quoteForActiveChart(candles, quote);
        const merged = activeQuote
          ? mergeLiveChartQuote(this.selectedSymbol, this.activeChartMode(), candles, activeQuote)
          : candles;
        if (merged !== candles) {
          if (identity) this.cacheChartSeries(identity, merged);
          // Not published here. A live merge answers with a new series for
          // every push, so each quote must wait for the coalesced redraw rather
          // than crossing the retained-view bridge with a full history window.
          this.chartDirty = true;
        }
      }
      this.quotePulse = 0.72;
      cx.timer.after(160, (cx) => {
        this.quotePulse = 1;
        this.scheduleRedraw(cx, PANE_DETAIL);
      });
      selected = true;
    }
    this.scheduleRedraw(cx, selected ? PANE_BOTH : PANE_WATCHLIST);
  }

  /** @param {import("gpui").Context} cx */
  loadSelectedChart(cx) {
    const symbol = this.selectedSymbol;
    const stream = this.stream;
    if (!symbol) {
      this.chartState = { symbol: null, state: "idle" };
      this.publishChart(cx);
      return;
    }
    const mode = this.activeChartMode();
    const identity = this.currentChartIdentity(symbol);
    const cached = this.hasCachedChartSeries(symbol);
    if (cached) this.cachedChartSeries(symbol);
    const generation = ++this.chartGeneration;
    this.chartState = {
      symbol,
      state: cached ? "ready" : "loading",
    };
    this.redraw(cx);
    this.publishChart(cx);
    if (!stream || cached) return;
    const request = this.chartRequestFor(symbol, mode);
    cx.spawn(async (cx) => {
      try {
        let candles;
        if (request.kind === "intraday") {
          const response = await stream.queryIntraday(request.params);
          candles = response.lines.map((line) => ({
            ...line,
            open: line.price,
            high: line.price,
            low: line.price,
            close: line.price,
          }));
        } else {
          const response = await stream.queryCandlesticks(request.params);
          candles = response.candlesticks;
        }
        if (!this.publishChartResponse(symbol, identity, generation, candles)) return;
      } catch (_) {
        if (!this.acceptsChartResponse(symbol, identity, generation)) return;
        this.chartState = {
          symbol,
          state: this.hasCachedChartSeries(symbol) ? "ready" : "error",
        };
      }
      this.redraw(cx);
      this.publishChart(cx);
    });
  }

  acceptsChartResponse(symbol, identity, generation) {
    return (
      generation === this.chartGeneration &&
      symbol === this.selectedSymbol &&
      identity !== null &&
      identity === this.currentChartIdentity(symbol)
    );
  }

  normalizeChartCandles(mode, candles) {
    const source = Array.isArray(candles) ? candles : EMPTY_CANDLES;
    if (mode === "intraday") return prepareIntradaySeries(source).candles;
    return prepareCandleSeries(source).candles;
  }

  publishChartResponse(symbol, identity, generation, candles) {
    if (!this.acceptsChartResponse(symbol, identity, generation)) return false;
    this.cacheChartSeries(identity, this.normalizeChartCandles(this.activeChartMode(), candles));
    this.chartState = { symbol, state: "ready" };
    return true;
  }

  quoteForActiveChart(candles, quote) {
    if (this.activeChartMode() !== "1D" || quote?.tradeSession !== TRADE_SESSION.NORMAL)
      return quote;
    const last = candles.at(-1);
    if (!last) return null;
    const lastMarketDay =
      typeof last.marketDay === "string"
        ? last.marketDay
        : typeof last.tradingDate === "string"
          ? last.tradingDate
          : null;
    const quoteMarketDay =
      typeof quote.marketDay === "string"
        ? quote.marketDay
        : typeof quote.tradingDate === "string"
          ? quote.tradingDate
          : null;
    if (lastMarketDay && quoteMarketDay) return lastMarketDay === quoteMarketDay ? quote : null;
    const lastBucket = providerDayBucket(last.timestamp);
    const quoteBucket = providerDayBucket(quote.timestamp);
    if (lastBucket === null || quoteBucket === null || lastBucket !== quoteBucket) return null;
    return { ...quote, dailyBucket: quoteBucket };
  }

  /**
   * Hands the chart its series on the next turn rather than in this one.
   *
   * `syncPriceChartView` crosses the nested-view bridge, and what it carries is
   * the whole selected window -- five sessions of minute candles is around two
   * thousand points, and the bridge costs about 0.03 ms each. Sixty
   * milliseconds is nothing on a background task and a stall on a click: the
   * frame that would have shown the new selection cannot be drawn until the
   * handler that started it returns, so the row highlighted late and the click
   * read as dropped. Deferring the publish lets the selection paint on the next
   * frame and the chart arrive on the one after.
   *
   * @param {import("gpui").Context | import("gpui").AsyncContext} cx
   */
  publishChart(cx) {
    if (this.chartPublish) return;
    this.chartPublish = cx.timer.after(0, (cx) => {
      this.chartPublish = null;
      this.syncPriceChartView();
      this.redraw(cx, PANE_DETAIL);
    });
  }

  /** @param {unknown} status @param {import("gpui").AsyncContext} cx */
  receiveStatus(status, cx) {
    this.status = status && typeof status === "object" ? status : { state: "error" };
    if (typeof this.status.error === "string") this.streamError = this.status.error;
    else if (this.status.state === "connected") this.streamError = "";
    this.redraw(cx);
  }

  /** @param {import("gpui").Context} cx */
  loadPortfolio(cx) {
    cx.spawn(async (cx) => {
      try {
        await this.refreshPortfolio();
        this.error = "";
        this.redraw(cx);
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        this.redraw(cx);
      }
    });
  }

  async refreshPortfolio() {
    // Keep authenticated reads sequential: if both discover an expired access
    // token together, two refresh-token rotations could race.
    const account = await get("/v1/asset/account", { currency: "USD" });
    const positions = await get("/v1/asset/stock");
    let exchangeRates = null;
    try {
      exchangeRates = await get("/v1/asset/exchange_rates");
    } catch (_) {
      // The account snapshot is already USD. Native-currency holdings remain
      // visibly unpriced until the optional exchange-rate read succeeds.
    }
    this.account = firstRecord(account);
    this.fxRates = normalizeUsdRates(exchangeRates);
    this.holdings = normalizeHoldings(positions);
    const previous = new Map(this.portfolioQuotes.map((quote) => [quote.symbol, quote]));
    this.portfolioQuotes = initialQuotes(
      this.holdings.map((holding) => {
        const [code, market = ""] = holding.symbol.split(".");
        return {
          symbol: holding.symbol,
          code,
          name: holding.name,
          market,
          currency: holding.currency,
        };
      }),
    ).map((quote) => previous.get(quote.symbol) ?? quote);
  }

  /** @param {"light" | "dark"} mode @param {import("gpui").Context} cx */
  chooseTheme(mode, cx) {
    if (this.followsSystemTheme) return;
    if (themes) {
      set_theme(themes[mode]);
      this.chartThemeRevision += 1;
      this.syncPriceChartView();
    }
    this.redraw(cx);
  }

  /** @param {import("gpui").Context} cx */
  toggleFps(cx) {
    this.fpsVisible = !this.fpsVisible;
    const visible = this.fpsVisible;
    cx.spawn(async () => saveFpsVisible(visible));
    this.redraw(cx);
  }

  /** @param {string} value @param {string} what @param {import("gpui").Context} cx */
  copyAuthorization(value, what, cx) {
    cx.write_to_clipboard(value);
    window.push_toast({ title: `${what} copied`, level: "success", id: "authorization-copy" });
  }

  /** @param {import("gpui").Context} cx */
  signOut(cx) {
    const stream = this.stream;
    if (stream) cx.spawn(() => stream.stop());
    this.stream = null;
    this.streamGeneration += 1;
    this.connectedToken = null;
    this.authorization = null;
    this.account = null;
    this.fxRates = new Map([["USD", 1]]);
    this.holdings = [];
    this.status = { state: "offline" };
    this.streamError = "";
    this.hasStoredTokens = false;
    this.instruments = [];
    this.quotes = [];
    this.portfolioQuotes = [];
    this.selectedSymbol = null;
    this.clearDetailMarket();
    this.depthCache?.clear();
    this.candleCache.clear();
    this.chartCache?.clear();
    this.chartGeneration += 1;
    this.chartState = { symbol: null, state: "idle" };
    this.releasePriceChartView();
    cx.spawn(async () => {
      await clearTokens();
    });
    this.redraw(cx);
  }

  /**
   * The workspace's actions, in the order the keymap above names them.
   *
   * Each is registered on the root rather than on the control it affects: an
   * action is dispatched down the focus path, and the root is the one element
   * every chord can reach whatever has the keyboard.
   *
   * @param {import("gpui").Element} element
   */
  workspaceActions(element) {
    return element
      .on_action("workspace::watchlist", (_event, cx) => this.showPage("watchlist", cx))
      .on_action("workspace::portfolio", (_event, cx) => this.showPage("portfolio", cx))
      .on_action("workspace::reconnect", (_event, cx) => this.resume(cx))
      .when(!this.followsSystemTheme, (workspace) =>
        workspace.on_action("workspace::toggle-theme", (_event, cx) =>
          this.chooseTheme(cx.theme().appearance === "dark" ? "light" : "dark", cx),
        ),
      )
      .on_action("workspace::toggle-fullscreen", () => window.toggle_fullscreen())
      .on_action("watchlist::next", (_event, cx) => this.stepSelection(1, cx))
      .on_action("watchlist::previous", (_event, cx) => this.stepSelection(-1, cx))
      .on_action("workspace::dismiss", (_event, cx) => this.dismiss(cx));
  }

  /**
   * Escape, and what it means here.
   *
   * The workspace claims it only when it has something to put away. When it
   * has not, `cx.propagate()` hands the action back so it carries on to
   * whatever is further out — which is how one chord serves a script-drawn
   * surface and base's own overlays without either knowing about the other.
   *
   * @param {import("gpui").Context} cx
   */
  dismiss(cx) {
    if (this.calendarOpen) {
      this.calendarOpen = false;
      this.redraw(cx);
      return;
    }
    if (this.userMenuOpen || this.allocationHelpOpen) {
      this.userMenuOpen = false;
      this.allocationHelpOpen = false;
      this.redraw(cx);
      return;
    }
    const filter = this.page === "portfolio" ? this.holdingsFilter : this.watchlistFilter;
    const query = this.page === "portfolio" ? this.holdingsQuery : this.watchlistQuery;
    if (query) {
      filter.set_value("");
      if (this.page === "portfolio") this.holdingsQuery = "";
      else this.watchlistQuery = "";
      this.redraw(cx);
      return;
    }
    cx.propagate();
  }

  /** @param {LongbridgePage} page @param {import("gpui").Context} cx */
  showPage(page, cx) {
    if (this.page === page) return;
    this.page = page;
    if (page === "portfolio") this.loadPortfolio(cx);
    this.redraw(cx);
  }

  /**
   * Moves the selection one row through the Watchlist as it is currently
   * filtered and sorted, which is the order on screen rather than the order
   * the API answered in.
   *
   * @param {number} delta @param {import("gpui").Context} cx
   */
  stepSelection(delta, cx) {
    if (this.page !== "watchlist") return;
    const rows = filterRows(this.quotes, this.watchlistQuery, ["code", "name", "symbol"]);
    if (rows.length === 0) return;
    const current = rows.findIndex((row) => row.symbol === this.selectedSymbol);
    const next = current < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, current + delta));
    this.selectQuote(rows[next].symbol, cx);
  }

  /**
   * Every chord the workspace sees, for the footer's readout.
   *
   * `keystroke` is the whole chord already unparsed — `"ctrl-shift-f"` — which
   * is the form a comparison is written against, and it is spelled the same on
   * every platform.
   *
   * `is_held` is only on the press half, which is the shape of the question:
   * a release is not held by definition.
   *
   * @param {import("gpui").KeyEvent} event
   * @param {boolean} down
   * @param {import("gpui").Context} cx
   */
  observeKey(event, down, cx) {
    const held = down && Boolean(event.is_held);
    if (event.keystroke === this.lastKeystroke && down === this.keyDown && held === this.keyHeld) {
      return;
    }
    this.lastKeystroke = event.keystroke;
    this.keyDown = down;
    this.keyHeld = held;
    this.redraw(cx);
  }

  /**
   * Whether the primary button is down, which nothing else can answer: a click
   * is reported once, after the release, and says nothing about the interval
   * between the two.
   *
   * @param {boolean} down @param {import("gpui").Context} cx
   */
  observePointer(down, cx) {
    if (this.pointerDown === down) return;
    this.pointerDown = down;
    this.redraw(cx);
  }

  /** @param {import("gpui").Context} cx */
  render(cx) {
    const tokens = cx.theme();
    const viewportWidth = Number(window.viewport_size().width);
    if (
      this.workspaceDock &&
      this.page === "watchlist" &&
      viewportWidth !== this.lastWorkspaceViewportWidth
    ) {
      this.lastWorkspaceViewportWidth = viewportWidth;
      this.queueWorkspaceDockReconcile(cx);
    }
    return this.workspaceActions(
      div()
        .id("workspace-root")
        .key_context("Workspace")
        .tab_index(0)
        .track_focus(this.workspaceFocus)
        .on_key_down((event, cx) => this.observeKey(event, true, cx))
        .on_key_up((event, cx) => this.observeKey(event, false, cx))
        .on_mouse_down("left", (_event, cx) => this.observePointer(true, cx))
        .on_mouse_up("left", (_event, cx) => this.observePointer(false, cx)),
    )
      .relative()
      .size_full()
      .child(
        v_flex()
          .w_full()
          .h_full()
          .bg(tokens.background)
          // The title bar reaches both edges and the window's very top, because
          // it *is* the window's top: there is no system one behind it. Only
          // what is under it is inset.
          .child(this.titleBar(tokens))
          .child(
            v_flex()
              .flex_1()
              .min_h(0)
              .px(PANE_INSET)
              .pb(PANE_INSET)
              .pt(0)
              .gap(tokens.spacing.sm)
              .child(
                // The performance overlay is anchored in *this* box rather than
                // in the window, which is what keeps it off the footer. Anchored
                // to the window it sat in the bottom-left corner, on top of
                // "Read only · Trading disabled"; anchored here it stops where
                // the workspace stops, which is the row above.
                v_flex()
                  .relative()
                  .flex_1()
                  .min_h(0)
                  .child(this.hasStoredTokens ? this.workspace(tokens) : this.loginGate(tokens))
                  .when(this.fpsVisible, (element) =>
                    element.child(fps_monitor().anchor("bottom_left")),
                  ),
              )
              .when(this.statusBarVisible, (element) => element.child(this.footer(tokens))),
          ),
      );
  }

  /**
   * The window's own title bar. There is no system one behind it: the host
   * opens the window with a transparent title bar, so this row is both the
   * application's chrome and the strip the window is dragged by.
   *
   * Three tracks, and the outer two share a width so the middle one is centered
   * on the window rather than on whatever is left over: identity on the left,
   * the page switch in the middle, the session's own controls on the right.
   * `TITLE_BAR_LEADING` is the room macOS needs for the traffic lights, which
   * are drawn over this corner by the system.
   *
   * @param {import("gpui-base").Theme} tokens
   */
  titleBar(tokens) {
    const status = statusColors(tokens);
    return (
      h_flex()
        .id("window-title-bar")
        .flex_none()
        .h(TITLE_BAR_HEIGHT)
        .w_full()
        .items_center()
        .gap(tokens.spacing.md)
        // Symmetric, so the page switch between the two tracks is centred on the
        // window rather than on a box that has been pushed right. The room macOS
        // needs for its traffic lights is the *left track's* padding, below: as
        // padding here it inset the content box on one side only, and the middle
        // came to rest 42 pixels right of centre.
        .px(tokens.spacing.sm)
        .bg(tokens.surface)
        .child(
          h_flex()
            .flex_1()
            .min_w(0)
            // The traffic lights are drawn over this corner by the system, so
            // the mark starts after them. On a platform without them this is the
            // ordinary gap.
            .pl(TITLE_BAR_LEADING - tokens.spacing.sm)
            // The mark and the name are one lockup, so they sit on a shared
            // baseline. Not `items_center`, which leaves the name floating above
            // the mark's foot, and not `items_end` either: that aligns the *line
            // box*, and a 1.25 line box keeps room under the baseline for
            // descenders, so the mark still ends up sitting low by that much.
            // Baseline alignment puts the mark's foot on the letters' own.
            .items_baseline()
            // 6, not a spacing token: this is the gap inside one lockup, which is
            // an optical fit between a mark and a wordmark rather than a layout
            // step. The scale's neighbours (4 and 8) are both wrong by eye here.
            .gap(6)
            .child(
              div()
                .relative()
                .w(20)
                .h(20)
                .flex_none()
                .accessibility_label("Longbridge")
                .child(
                  svg("assets/logo-foreground.svg")
                    .absolute()
                    .inset_0()
                    .text_color(tokens.foreground),
                )
                .child(
                  svg("assets/logo-info-cyan.svg").absolute().inset_0().text_color(status.info),
                )
                .child(
                  svg("assets/logo-warning.svg").absolute().inset_0().text_color(status.warning),
                )
                .child(svg("assets/logo-danger.svg").absolute().inset_0().text_color(status.down)),
            )
            .child(label(tokens, "Longbridge", 13).font_weight(700)),
        )
        // The switch is only a switch once there is something to switch between,
        // and both pages need a session.
        .when(this.hasStoredTokens, (element) => element.child(this.pageSwitch(tokens)))
        .child(
          h_flex()
            .flex_1()
            .min_w(0)
            .items_center()
            .justify_end()
            .gap(tokens.spacing.sm)
            .child(connectionPill(tokens, this.status.state))
            .when(
              this.hasStoredTokens && this.page === "watchlist" && Boolean(this.workspaceDock),
              (element) => {
                const open = this.workspaceDock.is_dock_open("right");
                return element.child(
                  detailToggle(tokens, open, (_event, cx) => {
                    this.workspaceDock.toggle_dock("right");
                    this.redraw(cx, 0);
                  }),
                );
              },
            )
            // Only on the page that has the pane it folds. Portfolio is one
            // column with no details beside it, so the control there would be a
            // switch for something that is not on screen.
            .when(!this.followsSystemTheme, (element) =>
              element.child(
                themeButton(tokens, (_event, cx) =>
                  this.chooseTheme(tokens.appearance === "dark" ? "light" : "dark", cx),
                ),
              ),
            )
            // The menu belongs to the session, not to the Watchlist: it signs out
            // and switches theme, and neither is a property of a list. The
            // window's own corner is where a session's controls live.
            .when(this.hasStoredTokens, (element) => element.child(this.userMenu(tokens))),
        )
    );
  }

  /**
   * The page switch, as one segmented control.
   *
   * Two tabs styled individually read as decoration -- a pair of quiet chips
   * with nothing saying they are alternatives -- and a selection has to be a
   * persistent state, not a hover. So the pair sits in one track: a recessed
   * background, with the current page distinguished by its foreground and
   * outline rather than a raised strip of panel colour.
   *
   * What carries the state is fill and foreground only. No border, which boxes
   * each segment and undoes the track, and no shadow, which reads as grime
   * under a 24px chip rather than as elevation. Weight is constant across
   * states for the same reason a border would be: a segment that changes weight
   * changes width, and the control twitches every time the page changes.
   *
   * This belongs in `ui.js` beside the other primitives, as `navTabs(tokens,
   * items, active, onSelect)`. It is written out here because `ui.js` has an
   * owner and a frozen export list; see the report.
   *
   * @param {import("gpui-base").Theme} tokens
   */
  pageSwitch(tokens) {
    return Tabs.new("workspace-tabs")
      .axis("horizontal")
      .accessibility_label("Pages")
      .flex()
      .items_center()
      .flex_none()
      .gap(2)
      .px(tokens.spacing.xs)
      .py(3)
      .rounded(tokens.radius.md)
      .bg(tokens.background)
      .border(1)
      .border_color(tokens.border)
      .children(
        PAGES.map((item) => {
          const selected = item.key === this.page;
          return motion(
            Tab.new(`page-${item.key}`)
              .selected(selected)
              .on_click((_event, cx) => this.showPage(item.key, cx))
              .flex()
              .items_center()
              .justify_center()
              .h(24)
              .px(tokens.spacing.md)
              .rounded(tokens.radius.sm)
              // Reserve the state border in both states so selection never
              // changes the tab's geometry.
              .border(1)
              .border_color(selected ? tokens.ring : tokens.background)
              .bg(selected ? tokens.accent : tokens.background)
              .text_size(12)
              .font_weight(700)
              .text_color(selected ? tokens.accent_foreground : tokens.muted_foreground),
            "opacity",
          )
            .hover((style) => style.text_color(tokens.foreground))
            .focus((style) => style.text_color(tokens.foreground))
            .child(item.caption);
        }),
      );
  }

  /**
   * Whether the window is short enough to stack the Watchlist over the
   * details rather than putting them side by side.
   *
   * `window.viewport_size()` is legal from `render`, which is where the
   * question is asked — a view that sizes itself from the window has to ask
   * during the pass that draws it. It is asked rather than remembered because
   * a value cached on the view would be a frame behind every resize.
   *
   * A resize is not itself an invalidation: a script view renders when it is
   * notified, not on every frame, and the runtime reports no resize event. So
   * the switch lands on the next notification — which, while a session is
   * live, is the clock a tick later at worst.
   */
  isNarrow() {
    return window.viewport_size().width < NARROW_VIEWPORT;
  }

  /**
   * Estimate the center region once per Watchlist paint. The result is passed
   * into every virtual row, avoiding the per-row host sizing calls that cut
   * Release throughput while still letting a wide Watchlist show its columns.
   */
  isWatchlistCompact() {
    const viewportWidth = window.viewport_size().width;
    if (!this.workspaceLayout) return viewportWidth < NARROW_VIEWPORT;
    try {
      const layout = this.workspaceLayout;
      const regions = [
        [layout.left_dock, layout.left_dock?.size ?? viewportWidth],
        [layout.right_dock, layout.right_dock?.size ?? viewportWidth],
        [layout.bottom_dock, viewportWidth],
        [
          { panel: layout.center },
          viewportWidth -
            (layout.left_dock?.open ? Number(layout.left_dock.size) || 0 : 0) -
            (layout.right_dock?.open ? Number(layout.right_dock.size) || 0 : 0),
        ],
      ];
      for (const [region, width] of regions) {
        const measured = panelWidthInTree(region?.panel, "watchlist", width);
        if (measured !== null) return measured < COMPACT_WATCHLIST_WIDTH;
      }
    } catch {}
    return viewportWidth < NARROW_VIEWPORT;
  }

  /** @param {import("gpui-base").Theme} tokens */
  workspace(tokens) {
    // Each page owns its own scrolling. Watchlist is a master-detail layout
    // whose panes scroll independently, and Portfolio is one long column — a
    // shared scroll container above them would either clip the panes or nest a
    // second scroll inside the first, which is what made Holdings unreachable
    // in a short window.
    const page =
      this.page === "portfolio"
        ? this.portfolioPage(tokens).id("workspace-page")
        : this.watchlistPage(tokens);
    return v_flex()
      .flex_1()
      .min_h(0)
      .gap(tokens.spacing.sm)
      .when(Boolean(this.error), (element) =>
        element.child(
          h_flex()
            .items_center()
            .justify_between()
            .gap(tokens.spacing.sm)
            .child(errorMessage(tokens, this.error).flex_1())
            .child(action(tokens, "retry-connection", "Retry", (_event, cx) => this.resume(cx))),
        ),
      )
      .child(motion(page.flex_1().min_h(0), "opacity"));
  }

  /**
   * A workspace pane's outer box. Only the side facing the other pane is
   * inset: together they form an 8px center gap without changing the window's
   * own 8px outer margin.
   *
   * @param {import("gpui-base").Theme} tokens
   * @param {"left" | "right"} facing Which side the other pane is on.
   */
  pane(tokens, facing) {
    // `flex_1().min_h(0)`, not `size_full()`. A percentage height only resolves
    // against a parent whose own height is already definite; where it is not,
    // `height: 100%` collapses to auto and every `flex_1` child inside falls
    // back to its content height -- the pane floating at the top of an empty
    // region. Growing into the parent's main axis asks for no such resolution.
    return v_flex()
      .flex_1()
      .min_h(0)
      .w_full()
      .bg(tokens.background)
      .when(facing === "left", (element) => element.pl(PANE_INSET))
      .when(facing === "right", (element) => element.pr(PANE_INSET));
  }

  /** @param {import("gpui-base").Theme} tokens */
  loginGate(tokens) {
    return h_flex()
      .flex_1()
      .items_center()
      .justify_center()
      .p(tokens.spacing.lg)
      .child(v_flex().w(400).child(this.authPanel(tokens)));
  }

  /**
   * The workspace, as a dock the user rearranges and keeps.
   *
   * The two panes used to be halves of a resizable group, which meant the
   * layout was a property of the description: the split had to be re-decided
   * every render, the narrow case needed a second group with its own id, and
   * nothing could be moved, collapsed or reordered. A dock area answers all
   * three — the layout is a value the user edits and this view only draws it.
   *
   * Base draws no chrome, so everything visible here is `ui.js`.
   *
   * @param {import("gpui-base").Theme} tokens
   */
  watchlistPage(tokens) {
    return dock_area(this.workspaceDock)
      .flex_1()
      .min_h(0)
      .tab_bar((group, cx) => dockTabBar(cx.theme(), group))
      .empty_group((_group, cx) => emptyPanel(cx.theme(), "Empty panel", "Drop a panel here."))
      .drop_indicator((drop, cx) => dockDropHint(cx.theme(), drop))
      .dock((dock, cx) =>
        dockFrame(cx.theme(), dock, dock_content().flex_1().min_h(0).w_full(), (cx, final) =>
          final || this.pointerDown ? this.queueWorkspaceDockReconcile(cx) : undefined,
        ),
      );
  }

  /** @param {import("gpui-base").Theme} tokens */
  watchlist(tokens) {
    const status = streamStatusSummary({ state: this.status.state, delay: this.status.delay });
    const rows = filterRows(this.quotes, this.watchlistQuery, ["code", "name", "symbol"]);
    const compact = this.isWatchlistCompact();
    return (
      panel(tokens)
        .id("watchlist-pane")
        // No top edge: the tab bar above this pane already draws the line, and
        // two of them at the same seam is a doubled border rather than a
        // stronger one.
        .border_t(0)
        .flex_1()
        .min_h(0)
        // On the pane rather than on whatever holds it: the pane is now a dock
        // panel's whole body, and there is no wrapper left to carry this.
        .on_mouse_down("right", (_event, cx) => this.copySelectedSymbol(cx))
        .child(
          tableToolbar(tokens)
            // No title here. The tab above this row already says "Watchlist",
            // and a pane that names itself twice is two headers wearing one
            // pane. What is left is what the tab cannot carry: the filter and
            // the feed's state.
            .child(filterInput(tokens, this.watchlistFilter))
            .child(muted(tokens, status)),
        )
        .child(rule(tokens))
        .when(Boolean(this.streamError), (element) =>
          element.child(errorMessage(tokens, streamStatusSummary(this.status))),
        )
        .child(
          this.instrumentTable(
            tokens,
            "watchlist",
            "Watchlist",
            rows,
            QUOTE_ROW_HEIGHT,
            watchlistHeader(tokens, compact),
            (quote, index) =>
              quoteRow(
                tokens,
                quote,
                quote.symbol === this.selectedSymbol,
                index,
                this.lastTick,
                compact,
              ),
            (symbol, cx) => this.selectQuote(symbol, cx),
            this.watchlistQuery
              ? emptyPanel(tokens, "No matches", "Nothing in the watchlist matches that filter.")
              : emptyPanel(
                  tokens,
                  "Watchlist is empty",
                  "Add securities in Longbridge, then reconnect to refresh this read-only view.",
                ),
            2,
          )
            .flex_1()
            .min_h(0),
        )
    );
  }

  /**
   * A virtualized table: a header row group, and a body whose rows are built
   * during layout for the range on screen.
   *
   * `row_count` describes the whole collection rather than what is drawn —
   * which is exactly what it is for, so a screen reader can say "row 5 of 200"
   * for a window onto a long list. It counts the header, which is row one.
   *
   * @param {import("gpui-base").Theme} tokens
   * @param {string} id
   * @param {string} name
   * @param {any[]} rows
   * @param {number} rowHeight
   * @param {import("gpui").Element} header
   * @param {(row: any, index: number) => import("gpui").Element} renderRow
   * @param {((key: string, cx: import("gpui").Context) => void) | null} onSelect
   * @param {import("gpui").Element} empty
   */
  instrumentTable(
    tokens,
    id,
    name,
    rows,
    rowHeight,
    header,
    renderRow,
    onSelect,
    empty,
    columnCount = 5,
  ) {
    const body = TableBody.new(`${id}-body`)
      .relative()
      .flex_1()
      .min_h(0)
      .child(
        // The renderer runs inside layout, so it registers nothing: selection
        // is the list's own `on_item_click`, reported as the row's stable
        // instrument key even if filtering or sorting changes its index before
        // a queued click is delivered.
        v_virtual_list(
          `${id}-rows`,
          rows.length,
          rowHeight,
          // A row's identity is its instrument, not its position. Both lists
          // reorder under it — the watchlist by session, holdings by market
          // value — and a key taken from the index would move a click onto
          // whatever slid into that slot.
          (index) => String(rows[index]?.symbol ?? index),
          (range) =>
            rows
              .slice(range.start, range.end)
              .map((row, offset) => renderRow(row, range.start + offset)),
        )
          .size_full()
          .when(Boolean(onSelect), (list) => list.on_item_click(onSelect)),
      )
      .child(Scrollbar.vertical(`${id}-rows`).absolute().inset_0());

    return Table.new(`${id}-table`)
      .accessibility_label(name)
      .row_count(rows.length + 1)
      .column_count(columnCount)
      .flex()
      .flex_col()
      .child(header)
      .child(rows.length ? body : empty);
  }

  /**
   * The session menu, in the window's top-right corner.
   *
   * `Popover` owns the press, the anchoring and the dismissal; the rows are
   * ordinary buttons carrying the menu-item role, because the runtime binds no
   * menu component to build them from.
   *
   * @param {import("gpui-base").Theme} tokens
   */
  userMenu(tokens) {
    const selected = this.quotes.find((quote) => quote.symbol === this.selectedSymbol);
    const close = (cx) => {
      this.userMenuOpen = false;
      this.redraw(cx);
    };
    return Popover.new("user-menu")
      .open(this.userMenuOpen)
      .on_open_change((open, cx) => {
        this.userMenuOpen = open;
        this.redraw(cx);
      })
      .trigger(sessionAvatar(tokens, "user-menu-trigger", "Session menu", this.userMenuOpen))
      .content(
        popoverSurface(tokens, { menu: true })
          .child(
            // The menu does what the chord does, by name. Neither knows about
            // the other: the reconnect chord is bound to this action in the keymap, the
            // root answers it, and this dispatches it down the same focus path
            // rather than calling the handler behind the keymap's back.
            menuItem(
              tokens,
              "user-menu-reconnect",
              "Reconnect stream",
              (_event, cx) => {
                close(cx);
                window.dispatch_action("workspace::reconnect");
              },
              { detail: chordLabel(`${PRIMARY_MODIFIER}-r`) },
            ),
          )
          .child(
            menuItem(tokens, "user-menu-reset-layout", "Reset layout", (_event, cx) => {
              close(cx);
              this.resetWorkspace(cx);
            }),
          )
          .child(
            menuItem(
              tokens,
              "user-menu-status-bar",
              this.statusBarVisible ? "Hide status bar" : "Show status bar",
              (_event, cx) => {
                close(cx);
                this.statusBarVisible = !this.statusBarVisible;
                this.redraw(cx);
              },
            ),
          )
          .child(
            menuItem(
              tokens,
              "user-menu-fps",
              this.fpsVisible ? "Hide FPS" : "Show FPS",
              (_event, cx) => {
                close(cx);
                this.toggleFps(cx);
              },
            ),
          )
          .child(
            menuItem(
              tokens,
              "user-menu-copy-symbol",
              "Copy selected symbol",
              (_event, cx) => {
                close(cx);
                if (selected) this.copyAuthorization(selected.symbol, "Symbol", cx);
              },
              { detail: selected ? selected.code : "", disabled: !selected },
            ),
          )
          .child(
            menuItem(
              tokens,
              "user-menu-refresh-chart",
              "Reload 5D chart",
              (_event, cx) => {
                close(cx);
                this.invalidateCurrentChartCache();
                this.loadSelectedChart(cx);
              },
              { disabled: !selected },
            ),
          )
          .child(rule(tokens))
          .when(!this.followsSystemTheme, (element) =>
            element
              .child(
                menuItem(
                  tokens,
                  "user-menu-theme",
                  tokens.appearance === "dark" ? "Light theme" : "Dark theme",
                  (_event, cx) => {
                    close(cx);
                    window.dispatch_action("workspace::toggle-theme");
                  },
                  { detail: chordLabel(`${PRIMARY_MODIFIER}-t`) },
                ),
              )
              .child(rule(tokens)),
          )
          // The window's own controls. They are `Window` methods over there
          // and `window` methods here, so this is the platform's zoom and the
          // platform's fullscreen rather than a size the script picked.
          .child(
            menuItem(
              tokens,
              "user-menu-fullscreen",
              window.is_fullscreen() ? "Leave full screen" : "Enter full screen",
              (_event, cx) => {
                close(cx);
                window.dispatch_action("workspace::toggle-fullscreen");
              },
              { detail: chordLabel(`${PRIMARY_MODIFIER}-shift-f`) },
            ),
          )
          .child(
            menuItem(
              tokens,
              "user-menu-zoom",
              window.is_maximized() ? "Unzoom" : "Zoom",
              (_event, cx) => {
                close(cx);
                window.zoom_window();
              },
            ),
          )
          .child(
            menuItem(tokens, "user-menu-minimize", "Minimize", (_event, cx) => {
              close(cx);
              window.minimize_window();
            }),
          )
          .child(rule(tokens))
          .child(
            // The only way out while signed in: the sign-in card is not on
            // screen once a session is live, so its "Clear session" cannot be
            // reached from here.
            menuItem(
              tokens,
              "user-menu-sign-out",
              "Sign out",
              (_event, cx) => {
                close(cx);
                this.signOut(cx);
              },
              { destructive: true },
            ),
          )
          .child(rule(tokens))
          .child(
            // Leaving is in the menu because the window no longer carries a
            // system title bar on every platform: macOS still draws its traffic
            // lights over the corner, but a Linux window has no close button of
            // its own to offer. `process.exit` is a request -- the host decides
            // what it means, and this one quits -- so the keyboard route and
            // this item end in the same place. The hint is spelled as the
            // binding `src/main.rs` actually registers, like every other hint
            // in this menu.
            menuItem(
              tokens,
              "user-menu-exit",
              "Exit",
              (_event, cx) => {
                close(cx);
                exit(0);
              },
              { detail: chordLabel(MACOS ? "cmd-q" : "alt-f4") },
            ),
          ),
      );
  }

  /**
   * A right press anywhere in the Watchlist copies the selected instrument.
   *
   * `on_click` cannot say this: it reports neither which button was pressed
   * nor how many presses ago, and a row cannot carry a handler of its own —
   * rows are rebuilt every frame the list scrolls. So the pane carries one.
   *
   * The press stops here. The pane sits inside a resizable group inside the
   * workspace, and neither of those has any business with a copy.
   *
   * @param {import("gpui").Context} cx
   */
  copySelectedSymbol(cx) {
    cx.stop_propagation();
    const quote = this.quotes.find((entry) => entry.symbol === this.selectedSymbol);
    if (quote) this.copyAuthorization(quote.symbol, "Symbol", cx);
  }

  /**
   * @param {string} symbol The virtual list's stable item key.
   * @param {import("gpui").Context} cx
   */
  selectQuote(symbol, cx) {
    if (!symbol || symbol === this.selectedSymbol) return;
    this.selectDetailMarket(symbol, cx);
    // Paint the selection first. `loadSelectedChart` publishes the chart, and
    // publishing it is the expensive half of this click -- see `publishChart`.
    this.redraw(cx);
    this.loadSelectedChart(cx);
  }

  // Test probes that draw the old inline shell still call this method. The
  // application dock never does: production gives each child its own tile.
  stockDetail(tokens) {
    return v_flex()
      .size_full()
      .min_w(0)
      .min_h(0)
      .children([
        this.quoteDetailsPanel(tokens).flex_1().min_h(0),
        this.chartDetailsPanel(tokens).flex_1().min_h(0),
        this.marketDetailPanel(tokens).flex_1().min_h(0),
      ]);
  }

  selectedQuote() {
    return this.quotes.find((entry) => entry.symbol === this.selectedSymbol) ?? this.quotes[0];
  }

  /** Quote facts are always expanded: this dock tile is the disclosure. */
  quoteDetailsPanel(tokens) {
    const quote = this.selectedQuote();
    const toggle = (name) => (open, cx) => {
      this.detailSections = { ...this.detailSections, [name]: open };
      this.redraw(cx, PANE_QUOTE);
    };
    return panel(tokens)
      .id("quote-details-panel")
      .border_t(0)
      .flex_1()
      .min_w(0)
      .min_h(0)
      .bg(tokens.background)
      .child(
        quote
          ? v_flex()
              .flex_1()
              .min_h(0)
              .overflow_y_scrollbar()
              .child(quoteDetail(tokens, quote, this.lastTick, this.quotePulse ?? 1))
              .child(rule(tokens))
              .child(
                accordionGroup("quote-details-sections").child(
                  accordionSection(tokens, {
                    id: "detail-about",
                    title: "About this instrument",
                    detail: quote.market,
                    level: 3,
                    open: this.detailSections.about,
                    onToggle: toggle("about"),
                    body: v_flex()
                      .p(tokens.spacing.md)
                      .child(
                        detailGrid(tokens, [
                          { title: "Symbol", value: quote.symbol },
                          { title: "Market", value: quote.market || "--" },
                          { title: "Currency", value: quote.currency || "--" },
                          { title: "Stream sequence", value: String(quote.sequence ?? "--") },
                        ]),
                      ),
                  }),
                ),
              )
          : emptyPanel(
              tokens,
              "Watchlist is empty",
              "Add securities in Longbridge, then reconnect to refresh this read-only view.",
            ),
      );
  }

  /** The retained chart has its own tile and is never mounted by market-detail pushes. */
  chartDetailsPanel(tokens) {
    return panel(tokens)
      .id("chart-panel")
      .border_t(0)
      .flex_1()
      .min_w(0)
      .min_h(0)
      .bg(tokens.background)
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().child(this.chartSection(tokens)));
  }

  /** One market-reading scroll: Order Book then Time & Sales. */
  marketDetailPanel(tokens) {
    const quote = this.selectedQuote();
    return panel(tokens)
      .id("market-detail-panel")
      .border_t(0)
      .flex_1()
      .min_w(0)
      .min_h(0)
      .bg(tokens.background)
      .child(
        quote
          ? v_flex()
              .flex_1()
              .min_h(0)
              .overflow_y_scrollbar()
              .child(
                v_flex()
                  .gap(tokens.spacing.xs)
                  .py(tokens.spacing.xs)
                  .child(orderBookPanel(tokens, this.depthState, depthRatio(this.depthState)))
                  .child(
                    timeSalesPanel(tokens, this.tradesState, {
                      symbol: quote.symbol,
                      market: quote.market,
                    }),
                  ),
              )
          : emptyPanel(
              tokens,
              "Watchlist is empty",
              "Select a security to read its market detail.",
            ),
      );
  }

  /**
   * The chart, the day it ends on, and the two ways to change that day.
   *
   * The wheel is the second one, and it is what `on_scroll_wheel` is for:
   * `overflow_scroll()` would hand the gesture to a scroll container, and
   * there is nothing here to scroll — the gesture drives a value instead.
   *
   * @param {import("gpui-base").Theme} tokens
   */
  chartSection(tokens) {
    // `today()` is the day the state read when it was created, so a session
    // left open across midnight would still be holding yesterday. The ceiling
    // is the later of that and the clock, which is right either way.
    const today = [this.chartCalendar.today(), calendarDay(new Date())].sort().at(-1);
    const end = this.chartEndDate ?? today;
    const mode = this.activeChartMode();
    const modeDescription =
      mode === "intraday"
        ? `Trading day ${end}`
        : mode === "5D"
          ? `Five sessions to ${end}`
          : `${mode} bars ending ${end}`;
    const chartModes = [
      ["intraday", "Intraday"],
      ["5D", "5D"],
      ["1m", "1m"],
      ["5m", "5m"],
      ["15m", "15m"],
      ["1D", "1D"],
    ];
    return (
      v_flex()
        .relative()
        // Match the Stock Details section inset: the date controls, chart
        // heading, plot and date axis form one content column with Quote above.
        .px(tokens.spacing.md)
        .py(tokens.spacing.md)
        .gap(tokens.spacing.sm)
        .child(
          h_flex()
            .items_center()
            .gap(tokens.spacing.sm)
            .child(
              h_flex()
                .id("chart-mode-selector")
                .flex_1()
                .min_w(0)
                // Six compact commands remain one row at every dock width.
                // This viewport owns only horizontal overflow; vertical wheel
                // input remains with the Chart panel and cannot become a second
                // chart-height-consuming row of controls.
                .overflow_x_scroll()
                .child(
                  h_flex()
                    .flex_none()
                    .gap(tokens.spacing.xxs)
                    .children(
                      chartModes.map(([id, caption]) =>
                        action(
                          tokens,
                          `chart-mode-${id}`,
                          caption,
                          (_event, cx) => this.setChartMode(id, cx),
                          { variant: "ghost", selected: mode === id },
                        ).flex_none(),
                      ),
                    ),
                ),
            )
            .child(
              h_flex()
                .flex_none()
                .items_center()
                .gap(tokens.spacing.xs)
                .child(
                  action(
                    tokens,
                    "chart-date-picker",
                    end,
                    (_event, cx) => {
                      this.calendarOpen = !this.calendarOpen;
                      this.redraw(cx);
                    },
                    { variant: "ghost", selected: this.calendarOpen },
                  ),
                )
                .when(Boolean(this.chartEndDate), (element) =>
                  element.child(
                    action(
                      tokens,
                      "chart-date-today",
                      "Today",
                      (_event, cx) => {
                        this.setChartEnd(null, cx);
                      },
                      { variant: "ghost", quiet: true },
                    ),
                  ),
                ),
            ),
        )
        .child(muted(tokens, modeDescription))
        .child(
          div()
            .id("price-chart-wheel")
            // A wheel over the chart walks the window a day at a time. The
            // handler reads `delta.y` in pixels, which is what every device
            // reports; `delta_lines` is only there when one reported lines.
            .on_scroll_wheel((event, cx) => {
              const step = event.delta.y > 0 ? -1 : event.delta.y < 0 ? 1 : 0;
              if (step === 0) return;
              const next = shiftDay(end, step);
              this.setChartEnd(next > today ? null : next, cx);
            })
            .child(this.priceChart),
        )
        .when(this.calendarOpen, (element) => element.child(this.calendarSurface(tokens, today)))
    );
  }

  /**
   * The month the picker is showing, drawn from the retained `CalendarState`.
   *
   * It is the application's own surface rather than a `Popover`, which is what
   * `on_mouse_down_out` is for: a press anywhere outside puts it away, the
   * same listener base's own overlays close on.
   *
   * @param {import("gpui-base").Theme} tokens
   * @param {string} today
   */
  calendarSurface(tokens, today) {
    return div()
      .id("chart-calendar-surface")
      .absolute()
      .right(tokens.spacing.lg)
      .top(48)
      .w(220)
      .p(PANE_INSET)
      .bg(tokens.surface)
      .border(1)
      .border_color(tokens.border)
      .rounded(tokens.radius.md)
      .on_mouse_down_out((_event, cx) => {
        this.calendarOpen = false;
        this.redraw(cx);
      })
      .child(
        calendarGrid(tokens, this.chartCalendar, {
          selected: this.chartEndDate,
          latest: today,
          onPick: (day, cx) => {
            // `set_value` is what raises the state's own `change`, so the
            // reload is written once, in the handler `init` registered.
            this.chartCalendar.set_value(day);
            this.calendarOpen = false;
            this.redraw(cx);
          },
          onMonth: (delta, cx) => {
            if (delta < 0) this.chartCalendar.prev_month();
            else this.chartCalendar.next_month();
            this.redraw(cx);
          },
        }),
      );
  }

  /**
   * @param {string | null} day `null` puts the window back on today.
   * @param {import("gpui").Context} cx
   */
  setChartEnd(day, cx) {
    if (day === this.chartEndDate) return;
    this.chartEndDate = day;
    // The state raises `change` from `set_value`, and the handler `init`
    // registered is where the reload is written. Setting what it already holds
    // would be a host call and an event with nothing behind them.
    if (this.chartCalendar.value() !== day) this.chartCalendar.set_value(day);
    this.loadSelectedChart(cx);
    this.redraw(cx);
  }

  /** @param {import("gpui-base").Theme} tokens */
  portfolioPage(tokens) {
    const balance =
      this.account && typeof this.account === "object"
        ? /** @type {Record<string, unknown>} */ (this.account)
        : null;
    const presentation = portfolioPresentation(
      this.holdings,
      [...this.quotes, ...this.portfolioQuotes],
      this.fxRates,
    );
    const allocation = allocationInUsd(
      this.holdings,
      [...this.quotes, ...this.portfolioQuotes],
      this.fxRates,
    );
    const account = balance
      ? {
          netAssets: stringValue(balance.net_assets ?? balance.netAssets),
          totalCash: stringValue(balance.total_cash ?? balance.totalCash),
          buyingPower: stringValue(balance.buy_power ?? balance.buyPower),
          currency: "USD",
          risk: stringValue(balance.risk_level ?? balance.riskLevel),
        }
      : null;

    const holdingRows = filterRows(presentation.holdings, this.holdingsQuery, ["symbol", "name"]);
    // The page does not scroll; Holdings does. The two cards above it are as
    // tall as their content and the table takes the rest, which is what stops
    // the window growing a scrollbar of its own.
    //
    // That leaves exactly one scroll on this page, and it is the virtualized
    // one -- the table only builds the rows it is showing, so the taller the
    // window the more it draws and the less it pages. A scrolling *page* put a
    // second scroll outside that one, and a table with its own scroll inside a
    // scrolling column is how Holdings used to end up unreachable.
    return (
      v_flex()
        .flex_1()
        .min_h(0)
        .gap(tokens.spacing.md)
        // The summary and the ring share a row, four parts to six. They answer
        // the same question -- what is in this account -- from two directions,
        // and reading one under the other made the page a column of cards where
        // it is really two views of one thing. The ring takes the larger share:
        // it carries a legend beside it, and the summary is a handful of figures.
        //
        // `flex_wrap` because a narrow window cannot hold both: they stack rather
        // than squeezing the legend out of the ring.
        .child(
          h_flex()
            .flex_none()
            .flex_wrap()
            .items_stretch()
            .gap(tokens.spacing.md)
            .child(
              panel(tokens)
                .flex_basis(0)
                .flex_grow(4)
                .min_w(320)
                .child(
                  h_flex()
                    .items_center()
                    .justify_between()
                    // A stated height, not one that falls out of the contents:
                    // the card beside this one carries a 24px control in its
                    // header and this one carries only text, so left to their
                    // contents the two headings sat at different heights.
                    .h(CARD_HEADER_HEIGHT)
                    .px(tokens.spacing.md)
                    .child(
                      h_flex()
                        .items_baseline()
                        .gap(tokens.spacing.xs)
                        .child(label(tokens, "Portfolio summary", 14).font_weight(700))
                        .child(muted(tokens, account ? `Risk level ${account.risk}` : "Read only")),
                    ),
                )
                .child(rule(tokens))
                .child(
                  account
                    ? portfolioSummary(tokens, account, presentation.summaries)
                    : emptyPanel(
                        tokens,
                        "No account snapshot",
                        "Waiting for Longbridge account assets.",
                      ),
                ),
            )
            .when(allocation.slices.length > 0 || allocation.unpriced.length > 0, (element) =>
              element.child(
                panel(tokens)
                  .flex_basis(0)
                  .flex_grow(6)
                  .min_w(380)
                  .child(
                    h_flex()
                      .items_center()
                      .justify_between()
                      .h(CARD_HEADER_HEIGHT)
                      .px(tokens.spacing.md)
                      .child(
                        h_flex()
                          .items_baseline()
                          .gap(tokens.spacing.xs)
                          .child(label(tokens, "Asset allocation", 14).font_weight(700))
                          .child(muted(tokens, "Market value in USD")),
                      )
                      // The control stays opposite the heading; only the words
                      // that describe the card moved next to its name.
                      .child(this.allocationHelp(tokens, allocation)),
                  )
                  .child(rule(tokens))
                  .child(
                    h_flex()
                      .flex_wrap()
                      .items_start()
                      .gap(tokens.spacing.xl)
                      .p(tokens.spacing.md)
                      .child(
                        v_flex()
                          .flex_basis(360)
                          .flex_grow(1)
                          .child(allocationChart(tokens, allocation)),
                      ),
                  ),
              ),
            ),
        )
        .child(
          panel(tokens)
            .flex_1()
            .min_h(0)
            .child(
              tableToolbar(tokens)
                .flex_none()
                // The count sits with the title, not across the row from it. It
                // says how much of *this* is here, so it reads as part of the
                // heading; opposite the filter it read as a second control.
                .child(
                  h_flex()
                    .items_baseline()
                    .gap(tokens.spacing.xs)
                    .child(label(tokens, "Holdings", 14).font_weight(700))
                    .child(
                      muted(
                        tokens,
                        holdingRows.length === this.holdings.length
                          ? `${this.holdings.length} positions`
                          : `${holdingRows.length} of ${this.holdings.length} positions`,
                      ),
                    ),
                )
                .child(filterInput(tokens, this.holdingsFilter, 160)),
            )
            .child(rule(tokens))
            .child(
              this.instrumentTable(
                tokens,
                "holdings",
                "Holdings",
                holdingRows,
                HOLDING_ROW_HEIGHT,
                holdingsHeader(tokens),
                (holding, index) => holdingRow(tokens, holding, index),
                null,
                this.holdingsQuery
                  ? emptyPanel(tokens, "No matches", "No holding matches that filter.")
                  : emptyPanel(
                      tokens,
                      "No stock positions",
                      "This account currently reports no stock holdings.",
                    ),
              )
                // A definite height is what makes virtualization possible at all,
                // and this page is a scrolling column with no leftover height to
                // claim -- so it takes the leftover height of a page that no
                // longer scrolls, rather than being sized from a row count and
                // letting the page scroll past it.
                .flex_1()
                .min_h(0),
            ),
        )
    );
  }

  /**
   * The second `Popover` in the application, and deliberately a different
   * shape from the Watchlist menu: a card of explanatory text rather than a
   * list of commands, so it announces itself as a group and not a menu.
   *
   * @param {import("gpui-base").Theme} tokens
   * @param {ReturnType<import("./portfolio.js").allocationInUsd>} allocation
   */
  allocationHelp(tokens, allocation) {
    const priced = allocation.slices.length;
    return Popover.new("allocation-help")
      .open(this.allocationHelpOpen)
      .on_open_change((open, cx) => {
        this.allocationHelpOpen = open;
        this.redraw(cx);
      })
      .trigger(
        menuTrigger(
          tokens,
          "allocation-help-trigger",
          "How this chart is built",
          this.allocationHelpOpen,
        ),
      )
      .content(
        popoverSurface(tokens, { width: 280 })
          .child(label(tokens, "How this chart is built", 13).font_weight(700))
          .child(
            muted(
              tokens,
              "Positions are ranked by market value in USD. The five largest keep a colour of " +
                "their own; everything after them is folded into one grey Other, because a " +
                "sixth hue would repeat one that already means a different holding.",
            ),
          )
          .child(rule(tokens))
          .child(
            detailGrid(tokens, [
              { title: "Priced positions", value: String(priced) },
              { title: "Unpriced", value: String(allocation.unpriced.length) },
              { title: "Wedges drawn", value: String(Math.min(priced, 6)) },
            ]),
          ),
      );
  }

  /**
   * The sign-in screen.
   *
   * It is the only thing on screen when it is on screen, so it is laid out as
   * one card rather than as a panel among panels: the product mark, then the
   * one thing the person has to do next, then the controls for doing it. When
   * a device code is live that one thing is the code itself, which is why it
   * is the largest text in the application.
   *
   * @param {import("gpui-base").Theme} tokens
   */
  authPanel(tokens) {
    const device = this.authorization;
    const stored = this.hasStoredTokens;
    const needsAttention = stored && this.status.state === "error";

    // The chrome carries the identity -- the header above this is showing the
    // mark, the name and the tagline, and the footer is already saying the
    // terminal is read-only. So the card carries the task and nothing else;
    // repeating any of it here would be three of everything on one screen.
    return panel(tokens)
      .p(tokens.spacing.xl)
      .gap(tokens.spacing.lg)
      .child(
        device
          ? this.deviceCode(tokens, device)
          : v_flex()
              .items_center()
              .gap(tokens.spacing.xs)
              .child(
                label(
                  tokens,
                  needsAttention
                    ? "Session needs attention"
                    : stored
                      ? "Restoring your session"
                      : "Sign in to continue",
                  14,
                ).font_weight(700),
              )
              .child(
                muted(
                  tokens,
                  needsAttention
                    ? "Retry the saved session, or clear it and sign in again."
                    : stored
                      ? "Reconnecting with the saved Longbridge session."
                      : "Authorize this device with your Longbridge account.",
                ),
              ),
      )
      .when(Boolean(this.error), (element) => element.child(errorMessage(tokens, this.error)))
      .child(
        v_flex()
          .gap(tokens.spacing.sm)
          .child(
            action(
              tokens,
              "longbridge-sign-in",
              device ? "Waiting for approval" : stored ? "Retry connection" : "Sign in",
              (_event, cx) => (stored ? this.resume(cx) : this.signIn(cx)),
              { variant: stored ? "default" : "primary", disabled: Boolean(device) },
            ).w_full(),
          )
          .when(stored || Boolean(device), (element) =>
            element.child(
              action(
                tokens,
                "longbridge-sign-out",
                device ? "Cancel" : "Clear session",
                (_event, cx) => this.signOut(cx),
                { variant: "destructive", quiet: true },
              ).w_full(),
            ),
          ),
      );
  }

  /**
   * The live device-code step. Three numbered places, and the code between
   * them as the largest thing on the screen.
   *
   * @param {import("gpui-base").Theme} tokens
   * @param {{ userCode: string, verificationUri: string }} device
   */
  deviceCode(tokens, device) {
    return v_flex()
      .gap(tokens.spacing.sm)
      .child(step(tokens, 1, "Longbridge is open in your browser"))
      .child(step(tokens, 2, "Enter this code"))
      .child(deviceCodeBox(tokens, device.userCode || "--"))
      .child(step(tokens, 3, "Approve the request in Longbridge"))
      .child(
        h_flex()
          .gap(tokens.spacing.sm)
          .child(
            action(
              tokens,
              "copy-device-code",
              "Copy code",
              (_event, cx) => this.copyAuthorization(device.userCode, "Device code", cx),
              { variant: "ghost" },
            ).flex_1(),
          )
          .child(
            action(
              tokens,
              "copy-authorization-link",
              "Copy link",
              (_event, cx) =>
                this.copyAuthorization(device.verificationUri, "Authorization link", cx),
              { variant: "ghost" },
            ).flex_1(),
          ),
      );
  }

  /**
   * The footer: what is available here, and what is going on.
   *
   * Two rows, because they answer different questions. The rail says which
   * commands this view actually has; the status row says what the window and
   * the feed are doing, and it keeps the readout of the last chord delivered --
   * which is *what just happened*, not what is available, and the two are not
   * the same thing even though both are drawn as key caps.
   *
   * @param {import("gpui-base").Theme} tokens
   */
  footer(tokens) {
    const updated = this.quotes.reduce((latest, quote) => Math.max(latest, quote.receivedAt), 0);
    return v_flex()
      .flex_none()
      .gap(tokens.spacing.xs)
      .child(this.shortcutRail(tokens))
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .child(muted(tokens, "Read only · Trading disabled"))
          .child(this.windowReadout(tokens))
          .child(
            h_flex()
              .items_center()
              .gap(tokens.spacing.sm)
              .child(
                muted(
                  tokens,
                  updated
                    ? `Last tick ${Math.max(0, Math.floor((this.lastTick - updated) / 1_000))}s ago`
                    : "Awaiting quotes",
                ),
              )
              // The far corner, because the performance overlay is anchored in
              // the other one and a control underneath it cannot be pressed.
              .child(this.diagnostics(tokens)),
          ),
      );
  }

  /**
   * The chords this view has, drawn from the keymap rather than written out.
   *
   * Every entry is a binding in `KEY_BINDINGS`, so the rail cannot name a chord
   * that does not work: a rebinding changes what it draws, and deleting a
   * binding deletes its hint. `chordLabel` is what turns the keymap's spelling
   * into the reader's.
   *
   * Only what is available *here*. The two selection chords step through the
   * Watchlist and return immediately on any other page, and Escape is only
   * Escape while something is open to put away -- `dismiss` hands the action
   * onward when there is not. Listing either unconditionally would be listing a
   * command that does nothing, which is the one thing a hint rail must not do.
   *
   * @param {import("gpui-base").Theme} tokens
   */
  shortcutRail(tokens) {
    const available = (action) => {
      switch (action) {
        case "workspace::watchlist":
        case "workspace::portfolio":
        case "workspace::reconnect":
          return this.hasStoredTokens;
        case "workspace::toggle-theme":
          return !this.followsSystemTheme;
        case "watchlist::next":
        case "watchlist::previous":
          return this.hasStoredTokens && this.page === "watchlist";
        case "workspace::dismiss":
          return this.hasSomethingToDismiss();
        default:
          // Theme and full screen are the window's, and the window is always
          // there -- including on the sign-in screen.
          return true;
      }
    };
    const hints = KEY_BINDINGS.filter(
      (binding) => SHORTCUT_CAPTIONS[binding.action] && available(binding.action),
    );
    return (
      h_flex()
        .items_center()
        // It wraps rather than truncating or scrolling: a hint that ran off the
        // edge of a narrow window would be a hint nobody has.
        .flex_wrap()
        .gap(tokens.spacing.md)
        .children(
          hints.map((binding) =>
            h_flex()
              // The cap and its caption are one hint, so they do not wrap apart
              // from each other.
              .flex_none()
              .items_center()
              .gap(tokens.spacing.xs)
              .child(kbd(tokens, chordLabel(binding.keystroke)))
              .child(muted(tokens, SHORTCUT_CAPTIONS[binding.action])),
          ),
        )
    );
  }

  /** Whether Escape has something of this application's to put away. */
  hasSomethingToDismiss() {
    if (this.calendarOpen || this.userMenuOpen || this.allocationHelpOpen) return true;
    return Boolean(this.page === "portfolio" ? this.holdingsQuery : this.watchlistQuery);
  }

  /**
   * What the window says about itself, and the last chord it delivered.
   *
   * Every measurement here is legal from `render` — a view that sizes itself
   * from the window has to ask during the pass that draws it — and every one
   * of them mirrors a `Window` method by the same name. It doubles as the
   * readout that says the keyboard and the pointer are reaching the workspace
   * at all: the chord is drawn as a key, filled while it is still down.
   *
   * @param {import("gpui-base").Theme} tokens
   */
  windowReadout(tokens) {
    const viewport = window.viewport_size();
    const parts = [
      `${Math.round(viewport.width)}×${Math.round(viewport.height)}`,
      `${Math.round(window.rem_size())}px/rem`,
      // The theme, not `window.appearance()`. They are two different facts and
      // this row is read as "what am I looking at": the window reports the
      // *system's* appearance, so a dark interface on a machine set to light
      // mode said `light` while every pixel on screen said otherwise. The
      // window's own answer is still on screen -- the diagnostics popover
      // carries it, beside this one, where the two are labelled apart.
      tokens.appearance,
      window.is_window_active() ? "active" : "background",
    ];
    if (window.is_fullscreen()) parts.push("fullscreen");
    else if (window.is_maximized()) parts.push("zoomed");
    if (this.isNarrow()) parts.push("narrow");
    return (
      h_flex()
        .items_center()
        .gap(tokens.spacing.sm)
        .child(muted(tokens, parts.join(" · ")))
        .when(Boolean(this.lastKeystroke), (element) =>
          element.child(
            // Displayed the way the rail displays a chord, because it is the same
            // kind of thing said in the same kind of cap. A key the keymap does
            // not bind still arrives here -- `backspace`, a bare letter -- and
            // reads as its own name.
            kbd(tokens, chordLabel(this.lastKeystroke), {
              down: this.keyDown,
              held: this.keyHeld,
            }),
          ),
        )
        // Not through `chordLabel`: this is a button, not a chord, and the
        // formatter would read the hyphen as a modifier and say `Mouse + Left`.
        .when(this.pointerDown, (element) =>
          element.child(kbd(tokens, "Mouse left", { down: true })),
        )
    );
  }

  /**
   * Everything the window will answer, and everything it will do.
   *
   * This application is an example before it is a terminal, so the surface
   * that proves a binding works belongs on screen rather than only in a test.
   * The reads are all legal from `render` and are taken as the popover draws;
   * the changes are all refused from `render` and are on the buttons.
   *
   * @param {import("gpui-base").Theme} tokens
   */
  diagnostics(tokens) {
    const bounds = window.bounds();
    const pointer = window.mouse_position();
    const viewport = window.viewport_size();
    const command = (id, caption, run) =>
      action(tokens, id, caption, (_event, cx) => run(cx), { variant: "ghost", quiet: true });
    return Popover.new("shell-diagnostics")
      .open(this.diagnosticsOpen)
      .on_open_change((open, cx) => {
        this.diagnosticsOpen = open;
        this.redraw(cx);
      })
      .trigger(
        menuTrigger(
          tokens,
          "shell-diagnostics-trigger",
          "Window diagnostics",
          this.diagnosticsOpen,
        ),
      )
      .content(
        popoverSurface(tokens, { width: 300 })
          .child(label(tokens, "Window", 13).font_weight(700))
          .child(
            detailGrid(tokens, [
              {
                title: "Viewport",
                value: `${Math.round(viewport.width)}×${Math.round(viewport.height)}`,
              },
              {
                title: "Bounds",
                value: `${Math.round(bounds.x)},${Math.round(bounds.y)} ${Math.round(bounds.width)}×${Math.round(bounds.height)}`,
              },
              { title: "Rem size", value: `${window.rem_size()}px` },
              { title: "Line height", value: `${Math.round(window.line_height())}px` },
              {
                title: "Pointer",
                value: `${Math.round(pointer.x)},${Math.round(pointer.y)}`,
              },
              // Both, and labelled apart. The theme is what the interface is
              // drawn in and what the footer reports; the appearance is the
              // system's, which is the window fact this popover is here to
              // prove can be read at all. They disagree whenever someone runs
              // a dark interface on a machine set to light.
              { title: "Theme", value: tokens.appearance },
              { title: "Appearance", value: window.appearance() },
              { title: "Active", value: window.is_window_active() ? "yes" : "no" },
              {
                title: "State",
                value: window.is_fullscreen()
                  ? "full screen"
                  : window.is_maximized()
                    ? "zoomed"
                    : "normal",
              },
            ]),
          )
          .child(rule(tokens))
          .child(muted(tokens, "Text size"))
          .child(
            h_flex()
              .gap(tokens.spacing.xs)
              .children(
                // The scale's body, title and heading steps. 18 was not on
                // it, and a control that offers a size the interface never
                // draws in is offering a size nothing was measured against.
                [12, 14, 16].map((size) =>
                  command(`shell-rem-${size}`, `${size}px`, () =>
                    window.set_rem_size(size),
                  ).flex_1(),
                ),
              ),
          )
          .child(rule(tokens))
          .child(
            h_flex()
              .flex_wrap()
              .gap(tokens.spacing.xs)
              .child(command("shell-focus-next", "Focus next", () => window.focus_next()))
              .child(command("shell-focus-prev", "Focus previous", () => window.focus_prev()))
              .child(command("shell-activate", "Bring to front", () => window.activate_window()))
              // Every view in the window, not only this one -- which is the
              // difference between it and `cx.notify()`.
              .child(command("shell-refresh", "Redraw window", () => window.refresh())),
          ),
      );
  }
}
