// A standalone, read-only Longbridge desktop client. OAuth uses direct HTTP,
// quotes use the documented WebSocket protocol, and no trading API is exposed.

import { View, div, image } from "gpui";
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
  applyQuote,
  filterRows,
  initialQuotes,
  sortLikeTerminal,
  streamStatusSummary,
  watchlistInstruments,
} from "./market.js";
import { createQuoteStream } from "./quote_stream.js";
import { mergeLiveQuote, prepareFiveDaySeries } from "./chart.js";
import { allocationInUsd, normalizeUsdRates, portfolioPresentation } from "./portfolio.js";
import PriceChartView, { PRICE_CHART_LAYOUT } from "./price_chart_view.js";
import { DetailPanel, WatchlistPanel, holdWorkspaceApp } from "./workspace.js";
import {
  accordionGroup,
  accordionSection,
  action,
  allocationChart,
  connectionPill,
  detailGrid,
  emptyPanel,
  kbd,
  detailToggle,
  PANE_INSET,
  dockDropHint,
  dockFrame,
  dockTabBar,
  errorMessage,
  filterInput,
  HOLDING_ROW_HEIGHT,
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
  pager,
  panel,
  popoverSurface,
  sessionAvatar,
  portfolioSummary,
  quoteDetail,
  quoteRow,
  QUOTE_ROW_HEIGHT,
  rule,
  themeButton,
  watchlistHeader,
} from "./ui.js";

let themes = null;

// How many Holdings rows the panel shows before the page scrolls instead of
// the panel growing. Any ceiling would do; this one keeps the summary and the
// allocation chart reachable above it without a scroll.
/** Where the workspace layout is kept between runs, and under which shape. */
const WORKSPACE_LAYOUT_KEY = "workspace.layout";
// 2, because 1 was the layout that docked Watchlist on the left and left the
// details in the center. A saved layout from that build would put the
// placements straight back and take the details' collapse control with them.
const WORKSPACE_LAYOUT_VERSION = 2;
/** The detail dock's starting width; after that the user's drag decides. */
const DETAIL_DOCK_WIDTH = 460;

const HOLDINGS_VIEWPORT_ROWS = 10;
const EMPTY_CANDLES = Object.freeze([]);

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
const TITLE_BAR_LEADING = MACOS ? 96 : 12;

/**
 * The one font family the whole interface is drawn in.
 *
 * Omarchy's information hierarchy is monospaced, and its fallback chain is
 * `"JetBrains Mono", "JetBrainsMono Nerd Font", ui-monospace, monospace`. None
 * of that chain can be written here: `font_family` reaches GPUI's
 * `Font::family`, which is a *single* installed family name and not a CSS list.
 * A comma-separated value is looked up verbatim, matches nothing, and falls
 * through to GPUI's own fallback stack -- the platform's **proportional** UI
 * face. The generic names miss for the same reason: neither `monospace` nor
 * `ui-monospace` is a family CoreText will match.
 *
 * So the chain is not resolved here at all; it is removed. `src/main.rs`
 * bundles JetBrains Mono into the binary and registers it with the text system
 * before the first frame, which is what makes this one name resolve on every
 * machine -- including the ones with no JetBrains Mono installed, which is most
 * of them. A script cannot ask what is installed, and this is why it does not
 * have to. The name has to match the family in those files.
 *
 * Worth knowing what that means about what came before: `ui.js`'s `numeric()`
 * asked for `"monospace"`, so the figures in this application -- prices,
 * quantities, percentages, the whole reason a terminal is monospaced -- were
 * almost certainly never drawn in a mono face at all. A vector asserting
 * `.font_family[Str("monospace")]` could not have caught it either: it read the
 * string that was declared, not the face that got drawn. Bundling the typeface
 * fixes that as a side effect, which is why `numeric()` no longer names a
 * family and no element below the root does.
 */
const MONOSPACE = "JetBrains Mono";

/** Every panel a saved layout mentions, by the name it was registered under. */
function layoutPanels(node, found = []) {
  if (!node || typeof node !== "object") return found;
  const name = typeof node.panel_name === "string" ? node.panel_name : "";
  const slash = name.lastIndexOf("/");
  if (slash !== -1) found.push(name.slice(slash + 1));
  for (const child of node.children ?? []) layoutPanels(child, found);
  return found;
}

/**
 * Whether a saved layout still describes this workspace.
 *
 * A dump is the user's arrangement, and almost every arrangement is theirs to
 * keep -- but not one that has lost a pane. A layout naming fewer panels than
 * this window has restores a dock holding an empty group, which draws an
 * invitation to drop a pane into it and offers no way to get the missing one
 * back; the title bar's collapse control then folds that emptiness away and
 * brings it back. Panels are not closable any more, so nothing can reach that
 * state from here again, but a dump written before they stopped being closable
 * still can -- and discarding it costs the user a layout they can redo in two
 * drags, where keeping it costs them a pane they cannot.
 *
 * Extra panels are fine and deliberately not checked: a dump that mentions
 * something this build no longer registers is base's to carry forward, which
 * is how uninstalling and reinstalling an application keeps its place.
 *
 * @param {any} layout
 */
function usableLayout(layout) {
  const found = new Set([
    ...layoutPanels(layout?.center),
    ...["left_dock", "right_dock", "bottom_dock"].flatMap((dock) =>
      layoutPanels(layout?.[dock]?.panel),
    ),
  ]);
  return WORKSPACE_PANELS.every((name) => found.has(name));
}

/** The panes this workspace is made of, by their registered names. */
const WORKSPACE_PANELS = Object.freeze(["watchlist", "detail"]);

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
const NARROW_VIEWPORT = 900;

/** How many holdings one page of the Holdings panel shows. */
const HOLDINGS_PAGE_SIZE = 8;

/**
 * The application keymap.
 *
 * Chords are bound to *actions*, not to handlers: the keymap says which chord
 * means `workspace::reconnect`, `on_action` says what that does, and the
 * session menu dispatches the same name through `window.dispatch_action`
 * without pretending to be a keyboard. `cmd` is the platform modifier on every
 * platform, including this one.
 *
 * @type {readonly import("gpui").KeyBinding[]}
 */
export const KEY_BINDINGS = Object.freeze([
  { keystroke: "cmd-1", action: "workspace::watchlist", context: "Workspace" },
  { keystroke: "cmd-2", action: "workspace::portfolio", context: "Workspace" },
  { keystroke: "cmd-r", action: "workspace::reconnect", context: "Workspace" },
  { keystroke: "cmd-t", action: "workspace::toggle-theme", context: "Workspace" },
  { keystroke: "cmd-shift-f", action: "workspace::toggle-fullscreen", context: "Workspace" },
  { keystroke: "alt-down", action: "watchlist::next", context: "Workspace" },
  { keystroke: "alt-up", action: "watchlist::previous", context: "Workspace" },
  { keystroke: "escape", action: "workspace::dismiss", context: "Workspace" },
]);

/**
 * How a chord is written for a reader, as opposed to how it is bound.
 *
 * A keystroke is `"cmd-shift-f"` everywhere it is *declared* -- that spelling
 * is the keymap's, it is the same string on every platform, and it is what a
 * comparison is written against. It is not what a person reads. The display
 * form is one grammar: modifiers in a fixed order, spaces around every `+`, and
 * one name per key rather than whatever the binding happened to abbreviate.
 *
 * Fixed order rather than the order the binding was written in, so `cmd-shift-f`
 * and a hypothetical `shift-cmd-f` would read the same. Deliberately Cmd and not
 * `Super`: `Super` is Hyprland's modifier and this is a macOS window, where the
 * platform modifier is Cmd and the runtime spells it `cmd` on every platform.
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

/** @param {string} keystroke A keymap chord, e.g. `"cmd-shift-f"`. */
export function chordLabel(keystroke) {
  const parts = String(keystroke).split("-");
  const key = parts.pop() ?? "";
  const modifiers = MODIFIER_ORDER.filter((name) => parts.includes(name)).map(
    (name) => MODIFIER_NAMES[name],
  );
  const named =
    KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1));
  return [...modifiers, named].join(" + ");
}

/**
 * What each bound action does, in the words the footer rail shows.
 *
 * Keyed by action rather than by chord, because the chord is the keymap's to
 * decide and this is only the caption beside it: rebinding `cmd-r` changes what
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
    cx.spawn(async (cx) => {
      themes = JSON.parse(await readFile("theme.json", "utf8"));
      set_theme(themes.dark);
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
    // Off unless asked for. The rail names every binding and the row under it
    // reports the window's own measurements -- both are for learning the
    // application and for reading a bug report, and neither is worth four
    // lines of a market terminal once you know them.
    this.statusBarVisible = false;
    this.candleCache = new Map();
    this.chartState = { symbol: null, state: "idle" };
    this.chartGeneration = 0;
    this.chartThemeRevision = 0;
    this.initInteractionState();
    this.initKeyboard(cx);
    this.initChartCalendar(cx);
    this.initPriceChartView(cx);
    this.initWorkspaceDock(cx);
    this.clock = cx.timer.every(1_000, (cx) => {
      this.lastTick = Date.now();
      this.quotes = sortLikeTerminal(this.quotes, this.lastTick);
      this.redraw(cx);
    });
    if (this.hasStoredTokens) this.resume(cx);
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
    // Focus is a fact about the window, and the window exists by the time a
    // task runs. Requesting it inside `init` itself would come before the
    // element tracking the handle has ever been drawn.
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
      this.candleCache.delete(this.selectedSymbol);
      this.loadSelectedChart(cx);
      this.redraw(cx);
    });
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
  nextPriceChartProps() {
    const symbol = this.selectedSymbol ?? "";
    const candles = symbol ? (this.candleCache.get(symbol) ?? EMPTY_CANDLES) : EMPTY_CANDLES;
    const state =
      this.chartState.symbol === symbol ? this.chartState.state : symbol ? "loading" : "idle";
    return {
      symbol,
      series: prepareFiveDaySeries(symbol, candles),
      state,
      layout: PRICE_CHART_LAYOUT,
      themeRevision: this.chartThemeRevision,
    };
  }

  /** Pushes props only when a chart input changed, and only from mutation sites. */
  syncPriceChartView() {
    if (!this.priceChart) return;
    const next = this.nextPriceChartProps();
    const previous = this.publishedPriceChartProps;
    if (
      previous?.symbol === next.symbol &&
      previous?.series === next.series &&
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
   * Creates the workspace dock and its two panels.
   *
   * The layout is the user's, not the application's: which pane is where, how
   * wide the watchlist is, whether it is collapsed. So it lives in a retained
   * `DockArea` and is written back to storage whenever it changes, rather than
   * being described afresh on every render — a dock rebuilt from a description
   * would undo every drag the moment anything else redrew.
   *
   * @param {import("gpui").Context} cx
   */
  initWorkspaceDock(cx) {
    // Before anything can rebuild a panel. A pane the dock reconstructs from a
    // saved layout is constructed with no props, so the application it draws
    // cannot arrive that way; it takes the held one instead.
    holdWorkspaceApp(this);
    // Registered before the layout is restored: this is what lets a saved
    // layout find the class its panel is rebuilt from.
    DockArea.register_panel("watchlist", WatchlistPanel);
    DockArea.register_panel("detail", DetailPanel);

    // Reset runs this a second time, so nothing here may assume it is the
    // first: the dock, its panels and the restored flag are all replaced
    // wholesale rather than added to.
    this.workspaceRevision = 0;
    // Set when `load` below rebuilds the panels, because that changes which
    // call repaints them. See `redraw`.
    this.workspaceRestored = false;
    this.workspaceDock = DockArea.new("longbridge-workspace", { version: WORKSPACE_LAYOUT_VERSION });
    this.watchlistPanel = cx.new(WatchlistPanel, { app: this });
    this.detailPanel = cx.new(DetailPanel, { app: this });
    // Watchlist is the center and the details are the right dock, which is the
    // opposite of how they started. Only a left, right or bottom dock is a
    // *dock*: the center is the area itself, it has no frame, and so it has no
    // collapse control -- which put the affordance on the pane nobody wants to
    // put away. The watchlist is the list this window is for; the details are
    // what it is showing about one row of it, and that is the half worth
    // folding out of the way.
    // `closable: false` on both, and it is not only a matter of taste. A dock
    // whose last panel is closed keeps the dock and loses the panel, so the
    // window came back with an empty group offering to have a pane dropped in
    // it and no way to put the closed one back -- there is no "reopen" for a
    // panel this application never offers to close. Two panes that are always
    // both there cannot reach that state.
    this.workspaceDock.add_panel(this.watchlistPanel, {
      name: "watchlist",
      placement: "center",
      closable: false,
    });
    this.workspaceDock.add_panel(this.detailPanel, {
      name: "detail",
      placement: "right",
      closable: false,
      size: DETAIL_DOCK_WIDTH,
    });

    // Storage is a capability, and a layout is not worth failing to start over:
    // a host that granted none gets the seeded layout above and keeps it for
    // the session.
    try {
      const saved = localStorage.getItem(WORKSPACE_LAYOUT_KEY);
      // A layout written by an older build is ignored rather than repaired —
      // the panels above are already docked, so the window still opens.
      //
      // The check is here because nothing else makes one. `load` adopts the
      // version it reads rather than comparing it, which is deliberate: base
      // writes the number and hands it back, and deciding what a mismatch
      // *means* is the application's. So a bump is inert until this line reads
      // it, and version 1 — Watchlist on the left, details in the center —
      // would otherwise come straight back and take the collapse control off
      // the pane that now has it.
      const layout = saved ? JSON.parse(saved) : null;
      if (layout && layout.version === WORKSPACE_LAYOUT_VERSION && usableLayout(layout)) {
        this.workspaceDock.load(layout);
        this.workspaceRestored = true;
      }
    } catch {
      this.layoutStorage = false;
    }

    // Fires on every edit, including each step of a drag, so the write is on a
    // timer rather than on the event.
    this.workspaceDock.on("layout_changed", (cx) => {
      this.redraw(cx);
      if (this.layoutWrite) return;
      this.layoutWrite = cx.timer.after(400, () => {
        this.layoutWrite = null;
        if (this.layoutStorage === false) return;
        try {
          localStorage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify(this.workspaceDock.dump()));
        } catch {
          this.layoutStorage = false;
        }
      });
    });
  }

  /**
   * Repaints the two panes.
   *
   * A dock panel is not a child of this view's description — the dock area
   * holds it — so `cx.notify()` here repaints the header, the footer and the
   * chrome, and reaches neither pane. This is the other half of that: it hands
   * each panel a revision it never reads, because what the call is for is the
   * refresh, not the value.
   */
  syncWorkspacePanels() {
    if (!this.workspaceDock) return;
    // A revision and nothing else. The application used to ride along in these
    // props, and it costs: `set_props` crosses the nested-view bridge, so this
    // handed the whole view -- quotes, holdings, the candle cache -- over it
    // once a second, and the operation was interrupted for overrunning the
    // sandbox's budget every time. The panes then did not repaint at all, which
    // is the opposite of what this call is for.
    //
    // Nothing is lost. A pane takes the application from `workspace.js`'s held
    // reference, which is also the only way a pane rebuilt from a saved layout
    // could ever have got one.
    const props = { revision: (this.workspaceRevision += 1) };
    this.watchlistPanel?.set_props(props);
    this.detailPanel?.set_props(props);
  }

  /**
   * Repaints soon, and at most once however many callers ask in between.
   *
   * A quote is not a reason to repaint on its own. They arrive in bursts --
   * every instrument in a live Hong Kong and A-share watchlist, several times a
   * second each -- and `redraw` on a restored layout is `window.refresh()`,
   * which repaints everything, the price chart included. One of those per quote
   * is what took this window to seven frames a second.
   *
   * So a quote sets state and asks for a repaint, and this decides when: the
   * first ask schedules one and the rest of the burst ride on it. A tenth of a
   * second is under what reads as delay and far over the rate the pushes arrive
   * at, which is the point -- the cost stops scaling with how chatty the market
   * is.
   *
   * @param {import("gpui").Context} cx
   */
  scheduleRedraw(cx) {
    if (this.repaint) return;
    this.repaint = cx.timer.after(100, (cx) => {
      this.repaint = null;
      if (this.chartDirty) {
        this.chartDirty = false;
        this.syncPriceChartView();
      }
      this.redraw(cx);
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
  redraw(cx) {
    cx.notify();
    if (this.workspaceRestored) {
      // A restored layout's panes are not the two this view created. `load`
      // rebuilds every panel through the registry, so `this.watchlistPanel` and
      // `this.detailPanel` are orphans from that moment on and `set_props` on
      // them repaints nothing that is on screen — the window would come up
      // correct and then freeze at the first quote. Nothing can re-acquire the
      // live ones either: `panels()` answers with names and ids, not handles,
      // and it answers with the layout as it stood *before* this turn's edits.
      //
      // So the whole window is refreshed instead of two views being notified.
      // It is the heavier call — every view redraws, the price chart included,
      // where `set_props` would have left it alone — and it is confined to the
      // case that needs it, which is why the flag exists rather than this being
      // what `redraw` always does.
      window.refresh();
      return;
    }
    this.syncWorkspacePanels();
  }

  releasePriceChartView() {
    if (!this.priceChart) return;
    this.priceChart.release();
    this.priceChart = null;
    this.publishedPriceChartProps = null;
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
    this.detailSections = { quote: true, chart: true, about: false };
    /** The one-based page the Holdings panel is showing. */
    this.holdingsPage = 1;
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
      // A narrower list can be shorter than the page someone is standing on.
      this.holdingsPage = 1;
      this.redraw(cx);
    });
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
    const previous = this.stream;
    this.stream = null;
    if (previous) await previous.stop();
    if (generation !== this.streamGeneration) return;
    this.status = { state: "loading_watchlist" };
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
      onStatus: (status) => {
        if (generation === this.streamGeneration && this.stream === stream)
          this.receiveStatus(status, cx);
      },
    });
    this.stream = stream;
    await stream.start();
    if (generation !== this.streamGeneration) {
      await stream.stop();
      return;
    }
    this.loadSelectedChart(cx);
  }

  /** @param {unknown} quote @param {import("gpui").AsyncContext} cx */
  receiveQuote(quote, cx) {
    // Deliberately no re-sort here. `sortLikeTerminal` ranks a row from trade
    // session counts taken across the whole list, so running it per quote made
    // the connect burst -- the whole watchlist twice over, snapshot plus
    // isFirstPush, in one synchronous run -- cost seconds and overrun the
    // sandbox's task budget, which unwound the stream before it could reach
    // `connected`. The one-second clock already re-sorts.
    const receivedAt = Date.now();
    this.quotes = applyQuote(this.quotes, quote, receivedAt);
    this.portfolioQuotes = applyQuote(this.portfolioQuotes, quote, receivedAt);
    if (quote && typeof quote === "object" && quote.symbol === this.selectedSymbol) {
      const candles = this.candleCache.get(this.selectedSymbol);
      if (candles) {
        const merged = mergeLiveQuote(this.selectedSymbol, candles, quote);
        if (merged !== candles) {
          this.candleCache.set(this.selectedSymbol, merged);
          // Not published here. `mergeLiveQuote` answers with a new series for
          // every push, so the identity guard in `syncPriceChartView` never
          // holds on this path and each quote handed the whole five days of
          // candles across the nested-view bridge -- which is the other thing
          // that was being interrupted for overrunning the sandbox's budget.
          // The coalesced repaint publishes it instead.
          this.chartDirty = true;
        }
      }
      this.quotePulse = 0.72;
      cx.timer.after(160, (cx) => {
        this.quotePulse = 1;
        this.scheduleRedraw(cx);
      });
    }
    this.scheduleRedraw(cx);
  }

  /** @param {import("gpui").Context} cx */
  loadSelectedChart(cx) {
    const symbol = this.selectedSymbol;
    const stream = this.stream;
    if (!symbol) {
      this.chartState = { symbol: null, state: "idle" };
      this.syncPriceChartView();
      return;
    }
    const generation = ++this.chartGeneration;
    this.chartState = {
      symbol,
      state: this.candleCache.has(symbol) ? "ready" : "loading",
    };
    this.syncPriceChartView();
    this.redraw(cx);
    if (!stream) return;
    // The window ends on the day the picker chose, and on today when it has
    // chosen nothing. Fourteen calendar days back is enough to contain five
    // trading sessions across a holiday.
    const end = this.chartEndDate ? new Date(`${this.chartEndDate}T12:00:00`) : new Date();
    const start = new Date(end.getTime() - 14 * 86_400_000);
    const compact = (date) => date.toISOString().slice(0, 10).replaceAll("-", "");
    cx.spawn(async (cx) => {
      try {
        const response = await stream.queryCandlesticks({
          symbol,
          startDate: compact(start),
          endDate: compact(end),
        });
        if (generation !== this.chartGeneration || symbol !== this.selectedSymbol) return;
        this.candleCache.set(symbol, response.candlesticks);
        this.chartState = { symbol, state: "ready" };
      } catch (_) {
        if (generation !== this.chartGeneration || symbol !== this.selectedSymbol) return;
        this.chartState = {
          symbol,
          state: this.candleCache.has(symbol) ? "ready" : "error",
        };
      }
      this.syncPriceChartView();
      this.redraw(cx);
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
    if (themes) {
      set_theme(themes[mode]);
      this.chartThemeRevision += 1;
      this.syncPriceChartView();
    }
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
    this.candleCache.clear();
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
      .on_action("workspace::toggle-theme", (_event, cx) =>
        this.chooseTheme(cx.theme().appearance === "dark" ? "light" : "dark", cx),
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
   * `keystroke` is the whole chord already unparsed — `"cmd-shift-f"` — which
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
      // Once, at the root. Every text style in GPUI cascades, so this is the
      // family the whole tree inherits and no element below states one of its
      // own -- see `MONOSPACE` for why it is a single name and not a chain.
      .font_family(MONOSPACE)
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
              .p(tokens.spacing.sm)
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
                  .child(fps_monitor().anchor("bottom_left")),
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
    return h_flex()
      .id("window-title-bar")
      .flex_none()
      .h(TITLE_BAR_HEIGHT)
      .w_full()
      .items_center()
      .gap(tokens.spacing.md)
      .pl(TITLE_BAR_LEADING)
      .pr(tokens.spacing.md)
      .bg(tokens.surface)
      .border_b(1)
      .border_color(tokens.border)
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
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
            image(tokens.appearance === "dark" ? "assets/logo-dark.svg" : "assets/logo-light.svg")
              .w(20)
              .h(20)
              .flex_none()
              .accessibility_label("Longbridge"),
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
          .when(this.hasStoredTokens, (element) =>
            element.child(
              detailToggle(tokens, this.isDetailOpen(), (_event, cx) => this.toggleDetail(cx)),
            ),
          )
          .child(
            themeButton(tokens, (_event, cx) =>
              this.chooseTheme(tokens.appearance === "dark" ? "light" : "dark", cx),
            ),
          )
          // The menu belongs to the session, not to the Watchlist: it signs out
          // and switches theme, and neither is a property of a list. The
          // window's own corner is where a session's controls live.
          .when(this.hasStoredTokens, (element) => element.child(this.userMenu(tokens))),
      );
  }

  /**
   * The page switch, as one segmented control.
   *
   * Two tabs styled individually read as decoration -- a pair of quiet chips
   * with nothing saying they are alternatives -- and a selection has to be a
   * persistent state, not a hover. So the pair sits in one track: a recessed
   * well in `muted`, with the current page filled in `background` and the
   * others showing the well through.
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
      .bg(tokens.muted)
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
              // An unselected segment is the well showing through, so it is
              // filled with the well's own colour rather than left unset: the
              // component brings a fill of its own, and this is what makes it
              // not show.
              .bg(selected ? tokens.background : tokens.muted)
              .text_size(12)
              .font_weight(700)
              .text_color(selected ? tokens.foreground : tokens.muted_foreground),
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
   * A workspace pane's outer box: the panel inside it, and this pane's half of
   * the gap between the two of them, on the side it faces.
   *
   * The inset is here rather than on the panel because a panel draws its own
   * border and fill, so padding written on it would put the gap *inside* that
   * border and separate nothing. It is here rather than on the dock, too: a
   * dock's frame is chrome around the pane, and what needs to move is the pane.
   *
   * @param {import("gpui-base").Theme} tokens
   * @param {"left" | "right"} facing Which side the other pane is on.
   */
  pane(tokens) {
    // The same inset the tab bar takes, on both sides, so a pane's body lines
    // up with its own tab rather than sitting narrower inside it. Two adjacent
    // regions therefore show twice this of canvas between them.
    //
    // `flex_1().min_h(0)`, not `size_full()`. A percentage height only resolves
    // against a parent whose own height is already definite; where it is not,
    // `height: 100%` collapses to auto and every `flex_1` child inside falls
    // back to its content height -- the pane floating at the top of an empty
    // region. Growing into the parent's main axis asks for no such resolution.
    return v_flex().flex_1().min_h(0).w_full().px(PANE_INSET).bg(tokens.background);
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
   * Puts the workspace back the way it ships.
   *
   * A dock area is the one part of this window whose shape is the user's, and
   * the price of that is a shape they can get stuck in: a pane dragged into the
   * centre and its dock left holding nothing, a pane collapsed and its handle
   * off the edge of the window. Every one of those is recoverable by hand and
   * none of them is obvious, so the way back is a menu item rather than a
   * paragraph in a README.
   *
   * The stored layout goes first. Rebuilding the dock republishes one through
   * `layout_changed`, so clearing afterwards would only delete the layout that
   * was just written, and the next launch would restore the shape this is
   * supposed to be undoing.
   *
   * @param {import("gpui").Context} cx
   */
  resetWorkspace(cx) {
    if (this.layoutWrite) {
      this.layoutWrite = null;
    }
    try {
      localStorage.removeItem(WORKSPACE_LAYOUT_KEY);
    } catch {
      // A host that granted no storage has nothing to forget, and the rebuild
      // below is the part that matters.
      this.layoutStorage = false;
    }
    this.initWorkspaceDock(cx);
    this.redraw(cx);
    cx.notify();
    window.push_toast({ title: "Layout reset", level: "success", id: "workspace-reset" });
  }

  /**
   * Whether the stock details are showing.
   *
   * Read from the dock every time rather than mirrored on this view: the pane
   * can also be closed by dragging its edge shut, and a copy of the flag would
   * be wrong from the first time that happened.
   */
  isDetailOpen() {
    return Boolean(this.workspaceDock?.is_dock_open("right"));
  }

  /** @param {import("gpui").Context} cx */
  toggleDetail(cx) {
    if (!this.workspaceDock) return;
    this.workspaceDock.toggle_dock("right");
    // The dock writes its own layout back through `layout_changed`; this is
    // only the title bar catching up with the icon it should now be showing.
    cx.notify();
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
    // No `.dock()` here, deliberately. That hook does not decorate a dock --
    // it *replaces* base's whole `render_dock`, which is where a side dock's
    // own box comes from (`Left | Right => h_flex().h_full().w(size)`), along
    // with the early return that gives a closed dock no width and the resize
    // handle on its edge. Chrome that returns anything else has silently taken
    // over the layout, and a dock that no longer states its width stops being
    // a column beside the centre and drops into the flow below it.
    //
    // None of that is worth owning. The one thing this window wanted from dock
    // chrome was a collapse control, and `DockArea` exposes that directly --
    // `is_dock_open` and `toggle_dock` take a placement -- so the control lives
    // in the title bar and base keeps the layout it is good at.
    return dock_area(this.workspaceDock)
      .flex_1()
      .min_h(0)
      .tab_bar((group, cx) => dockTabBar(cx.theme(), group))
      .empty_group((_group, cx) => emptyPanel(cx.theme(), "Nothing here", "Drop a pane in."))
      .drop_indicator((drop, cx) => dockDropHint(cx.theme(), drop))
      // `dockFrame` is base's `render_dock`, ported. It has to be supplied:
      // gpui-shell replaces base's version whether or not an application asks,
      // and its default chrome hands back the content bare -- no width, so a
      // side dock stops being a column and drops into the flow below the
      // centre. See the note on `dockFrame`.
      .dock((dock, cx) => dockFrame(cx.theme(), dock, dock_content().flex_1().min_h(0)));
  }

  /** @param {import("gpui-base").Theme} tokens */
  watchlist(tokens) {
    const status = streamStatusSummary({ state: this.status.state, delay: this.status.delay });
    const rows = filterRows(this.quotes, this.watchlistQuery, ["code", "name", "symbol"]);
    return this.pane(tokens).child(
      panel(tokens)
        .id("watchlist-pane")
        .flex_1()
        .min_h(0)
        // On the pane rather than on whatever holds it: the pane is now a dock
        // panel's whole body, and there is no wrapper left to carry this.
        .on_mouse_down("right", (_event, cx) => this.copySelectedSymbol(cx))
        .child(
          h_flex()
            .items_center()
            .justify_between()
            .px(tokens.spacing.md)
            .py(tokens.spacing.sm)
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
            watchlistHeader(tokens),
            (quote, index) =>
              quoteRow(tokens, quote, quote.symbol === this.selectedSymbol, index, this.lastTick),
            (symbol, cx) => this.selectQuote(symbol, cx),
            this.watchlistQuery
              ? emptyPanel(tokens, "No matches", "Nothing in the watchlist matches that filter.")
              : emptyPanel(
                  tokens,
                  "Watchlist is empty",
                  "Add securities in Longbridge, then reconnect to refresh this read-only view.",
                ),
          )
            .flex_1()
            .min_h(0),
        ),
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
  instrumentTable(tokens, id, name, rows, rowHeight, header, renderRow, onSelect, empty) {
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
      .column_count(5)
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
            // the other: `cmd-r` is bound to this action in the keymap, the
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
              { detail: "cmd-r" },
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
              { detail: "Shortcuts and window state" },
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
                this.candleCache.delete(this.selectedSymbol);
                this.loadSelectedChart(cx);
              },
              { disabled: !selected },
            ),
          )
          .child(rule(tokens))
          .child(
            menuItem(
              tokens,
              "user-menu-theme",
              tokens.appearance === "dark" ? "Light theme" : "Dark theme",
              (_event, cx) => {
                close(cx);
                window.dispatch_action("workspace::toggle-theme");
              },
              { detail: "cmd-t" },
            ),
          )
          .child(rule(tokens))
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
              { detail: "cmd-shift-f" },
            ),
          )
          .child(
            menuItem(tokens, "user-menu-zoom", window.is_maximized() ? "Unzoom" : "Zoom", (_event, cx) => {
              close(cx);
              window.zoom_window();
            }),
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
              { detail: "Clears the saved session", destructive: true },
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
              { detail: MACOS ? "cmd-q" : "alt-f4" },
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
    this.selectedSymbol = symbol;
    this.loadSelectedChart(cx);
    this.redraw(cx);
  }

  /** @param {import("gpui-base").Theme} tokens */
  stockDetail(tokens) {
    const quote =
      this.quotes.find((entry) => entry.symbol === this.selectedSymbol) ?? this.quotes[0];
    return this.pane(tokens).child(
      panel(tokens)
        .id("stock-detail-pane")
        .flex_1()
        .min_h(0)
        .child(
          h_flex()
            .items_center()
            .justify_between()
            .px(tokens.spacing.md)
            .py(tokens.spacing.sm)
            // Same as the watchlist: the tab names the pane, so this row only
            // says what the tab cannot.
            .child(muted(tokens, "Real-time quote")),
        )
        .child(rule(tokens))
        .child(
          quote
            ? v_flex()
                .flex_1()
                .min_h(0)
                .overflow_y_scrollbar()
                .child(this.detailSectionsFor(tokens, quote))
            : emptyPanel(
                tokens,
                "Watchlist is empty",
                "Add securities in Longbridge, then reconnect to refresh this read-only view.",
              ),
        ),
    );
  }

  /**
   * The three things there are to say about an instrument, each behind its own
   * disclosure.
   *
   * A detail pane is a stack of unrelated readings, and in a narrow window all
   * three of them at once is a scroll rather than a view. The accordion parts
   * draw nothing — what they carry is what a screen reader reads: the group,
   * the heading and its level, the button and its expanded state, and the
   * region that button controls.
   *
   * The chart panel is `keep_mounted`: it holds a retained child view, and a
   * panel that left the tree on every collapse would tear that child down and
   * build a new one on the way back.
   *
   * @param {import("gpui-base").Theme} tokens
   * @param {LongbridgeQuoteRow} quote
   */
  detailSectionsFor(tokens, quote) {
    const toggle = (name) => (open, cx) => {
      this.detailSections = { ...this.detailSections, [name]: open };
      this.redraw(cx);
    };
    return accordionGroup("stock-detail-sections")
      .child(
        accordionSection(tokens, {
          id: "detail-quote",
          title: "Quote",
          detail: quote.code,
          level: 3,
          open: this.detailSections.quote,
          onToggle: toggle("quote"),
          body: quoteDetail(tokens, quote, this.lastTick, this.quotePulse ?? 1),
        }),
      )
      .child(
        accordionSection(tokens, {
          id: "detail-chart",
          title: "Price chart",
          detail: this.chartEndDate ? `to ${this.chartEndDate}` : "5 days",
          level: 3,
          open: this.detailSections.chart,
          keepMounted: true,
          onToggle: toggle("chart"),
          body: this.chartSection(tokens),
        }),
      )
      .child(
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
    return v_flex()
      .relative()
      .px(tokens.spacing.lg)
      .py(tokens.spacing.md)
      .gap(tokens.spacing.sm)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .gap(tokens.spacing.sm)
          .child(muted(tokens, `Five sessions to ${end}`))
          .child(
            h_flex()
              .items_center()
              .gap(tokens.spacing.xs)
              .child(
                action(tokens, "chart-date-picker", end, (_event, cx) => {
                  this.calendarOpen = !this.calendarOpen;
                  this.redraw(cx);
                }, { variant: "ghost", selected: this.calendarOpen }),
              )
              .when(Boolean(this.chartEndDate), (element) =>
                element.child(
                  action(tokens, "chart-date-today", "Today", (_event, cx) => {
                    this.setChartEnd(null, cx);
                  }, { variant: "ghost", quiet: true }),
                ),
              ),
          ),
      )
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
      .when(this.calendarOpen, (element) => element.child(this.calendarSurface(tokens, today)));
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
      .p(tokens.spacing.sm)
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
    this.candleCache.delete(this.selectedSymbol);
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
    // The panel shows one page of holdings rather than a capped window onto
    // all of them. `pagination_items` decides which page numbers are drawn and
    // where the runs collapse -- the one part of a pager a script cannot work
    // out for itself -- and the page is clamped here because a filter can make
    // the list shorter than the page someone is standing on.
    const holdingsPages = Math.max(1, Math.ceil(holdingRows.length / HOLDINGS_PAGE_SIZE));
    const holdingsPage = Math.min(Math.max(1, this.holdingsPage), holdingsPages);
    const pageStart = (holdingsPage - 1) * HOLDINGS_PAGE_SIZE;
    const pagedHoldings = holdingRows.slice(pageStart, pageStart + HOLDINGS_PAGE_SIZE);

    // One scrolling column, and every panel in it sized by its own content.
    // Nothing here is `flex_1`: a panel that took the leftover height would be
    // squeezed to nothing in a short window, and its inner scroll — a second
    // scroll inside this one — is where Holdings used to disappear.
    return v_flex()
      .overflow_y_scroll()
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
                  .px(tokens.spacing.md)
                  .py(tokens.spacing.sm)
                  .child(
                    h_flex()
                      .items_baseline()
                      .gap(tokens.spacing.xs)
                      .child(label(tokens, "Portfolio summary", 14).font_weight(700))
                      .child(
                        muted(tokens, account ? `Risk level ${account.risk}` : "Read only"),
                      ),
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
                    .px(tokens.spacing.md)
                    .py(tokens.spacing.sm)
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
          .flex_none()
          .child(
            h_flex()
              .items_center()
              .justify_between()
              .px(tokens.spacing.md)
              .py(tokens.spacing.sm)
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
              pagedHoldings,
              HOLDING_ROW_HEIGHT,
              holdingsHeader(tokens),
              (holding, index) => holdingRow(tokens, holding, pageStart + index),
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
              // claim. So the body is as tall as its rows up to a ceiling, and
              // the page scrolls past the panel once it hits it.
              .h(
                TABLE_HEADER_HEIGHT +
                  Math.min(pagedHoldings.length, HOLDINGS_VIEWPORT_ROWS) * HOLDING_ROW_HEIGHT,
              )
              .when(pagedHoldings.length === 0, (element) => element.h_auto()),
          )
          .when(holdingsPages > 1, (element) =>
            element.child(
              v_flex()
                .py(tokens.spacing.sm)
                .border_t(1)
                .border_color(tokens.border)
                .child(
                  pager(tokens, "holdings-pages", holdingsPage, holdingsPages, (page, cx) => {
                    this.holdingsPage = page;
                    this.redraw(cx);
                  }),
                ),
            ),
          ),
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
              (_event, cx) => this.copyAuthorization(device.verificationUri, "Authorization link", cx),
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
          .px(tokens.spacing.sm)
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
    return h_flex()
      .items_center()
      // It wraps rather than truncating or scrolling: a hint that ran off the
      // edge of a narrow window would be a hint nobody has.
      .flex_wrap()
      .gap(tokens.spacing.md)
      .px(tokens.spacing.sm)
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
    return h_flex()
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
      .when(this.pointerDown, (element) => element.child(kbd(tokens, "Mouse left", { down: true })));
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
      .trigger(menuTrigger(tokens, "shell-diagnostics-trigger", "Window diagnostics", this.diagnosticsOpen))
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
                  command(`shell-rem-${size}`, `${size}px`, () => window.set_rem_size(size)).flex_1(),
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
