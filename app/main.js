// A standalone, read-only Longbridge desktop client. OAuth uses direct HTTP,
// quotes use the documented WebSocket protocol, and no trading API is exposed.

import { View, div, image } from "gpui";
import {
  CalendarState,
  InputState,
  Popover,
  Scrollbar,
  Table,
  TableBody,
  Tab,
  Tabs,
  h_flex,
  h_resizable,
  resizable_panel,
  set_theme,
  v_flex,
  v_resizable,
  v_virtual_list,
} from "gpui-base";
import { fps_monitor } from "gpui-fps";
import { readFile } from "fs/promises";
import {
  accessToken,
  beginDeviceAuthorization,
  clearTokens,
  loadTokens,
  pollDeviceAuthorization,
} from "./auth.js";
import { get } from "./http.js";
import {
  filterRows,
  initialQuotes,
  mergeQuote,
  sortLikeTerminal,
  streamStatusSummary,
  watchlistInstruments,
} from "./market.js";
import { createQuoteStream } from "./quote_stream.js";
import { mergeLiveQuote, prepareFiveDaySeries } from "./chart.js";
import { allocationInUsd, normalizeUsdRates, portfolioPresentation } from "./portfolio.js";
import PriceChartView, { PRICE_CHART_LAYOUT } from "./price_chart_view.js";
import {
  accordionGroup,
  accordionSection,
  action,
  allocationChart,
  connectionPill,
  detailGrid,
  emptyPanel,
  kbd,
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
const HOLDINGS_VIEWPORT_ROWS = 10;
const EMPTY_CANDLES = Object.freeze([]);

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
    cx.spawn(async (cx) => {
      themes = JSON.parse(await readFile("theme.json", "utf8"));
      set_theme(themes.dark);
      this.chartThemeRevision += 1;
      this.syncPriceChartView();
      cx.notify();
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
    this.candleCache = new Map();
    this.chartState = { symbol: null, state: "idle" };
    this.chartGeneration = 0;
    this.chartThemeRevision = 0;
    this.initInteractionState();
    this.initKeyboard(cx);
    this.initChartCalendar(cx);
    this.initPriceChartView(cx);
    this.clock = cx.timer.every(1_000, (cx) => {
      this.lastTick = Date.now();
      this.quotes = sortLikeTerminal(this.quotes, this.lastTick);
      cx.notify();
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
      cx.notify();
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
      cx.notify();
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
      cx.notify();
    });
    this.holdingsFilter = InputState.new({ placeholder: "Filter holdings" });
    this.holdingsFilter.on("change", (_event, cx) => {
      this.holdingsQuery = this.holdingsFilter.value();
      // A narrower list can be shorter than the page someone is standing on.
      this.holdingsPage = 1;
      cx.notify();
    });
  }

  /** @param {import("gpui").Context} cx */
  resume(cx) {
    this.status = { state: "restoring_token" };
    this.error = "";
    this.streamError = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await this.connect(await accessToken(), cx);
      } catch (error) {
        this.status = { state: "error" };
        this.error = error instanceof Error ? error.message : String(error);
        cx.notify();
      }
    });
  }

  /** @param {import("gpui").Context} cx */
  signIn(cx) {
    if (this.authorization) return;
    this.status = { state: "authorizing" };
    this.error = "";
    cx.notify();
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
        cx.notify();
        const tokens = await pollDeviceAuthorization(authorization, { cx });
        this.hasStoredTokens = true;
        this.authorization = null;
        await this.connect(tokens.accessToken, cx);
      } catch (error) {
        this.authorization = null;
        this.status = { state: "error" };
        this.error = error instanceof Error ? error.message : String(error);
        cx.notify();
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
    cx.notify();

    const instruments = watchlistInstruments(await get(cx, "/v1/watchlist/groups"));
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
    cx.notify();
    await this.refreshPortfolio(cx);
    if (generation !== this.streamGeneration) return;
    const symbols = [
      ...new Set([
        ...instruments.map((instrument) => instrument.symbol),
        ...this.holdings.map((holding) => holding.symbol),
      ]),
    ];
    if (symbols.length === 0) {
      this.status = { state: "connected" };
      cx.notify();
      this.loadPortfolio(cx);
      return;
    }

    let stream;
    // The stream outlives this call, and so must the context its callbacks
    // notify through: `cx` here is the task's `AsyncContext`, which is the
    // flavour that may be held across an await.
    stream = createQuoteStream({
      cx,
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
    this.quotes = sortLikeTerminal(
      this.quotes.map((current) => mergeQuote(current, quote)),
      this.lastTick,
    );
    this.portfolioQuotes = this.portfolioQuotes.map((current) => mergeQuote(current, quote));
    if (quote && typeof quote === "object" && quote.symbol === this.selectedSymbol) {
      const candles = this.candleCache.get(this.selectedSymbol);
      if (candles) {
        const merged = mergeLiveQuote(this.selectedSymbol, candles, quote);
        if (merged !== candles) {
          this.candleCache.set(this.selectedSymbol, merged);
          this.syncPriceChartView();
        }
      }
      this.quotePulse = 0.72;
      cx.timer.after(160, (cx) => {
        this.quotePulse = 1;
        cx.notify();
      });
    }
    cx.notify();
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
    cx.notify();
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
      cx.notify();
    });
  }

  /** @param {unknown} status @param {import("gpui").AsyncContext} cx */
  receiveStatus(status, cx) {
    this.status = status && typeof status === "object" ? status : { state: "error" };
    if (typeof this.status.error === "string") this.streamError = this.status.error;
    else if (this.status.state === "connected") this.streamError = "";
    cx.notify();
  }

  /** @param {import("gpui").Context} cx */
  loadPortfolio(cx) {
    cx.spawn(async (cx) => {
      try {
        await this.refreshPortfolio(cx);
        this.error = "";
        cx.notify();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        cx.notify();
      }
    });
  }

  /** @param {import("gpui").AsyncContext} cx */
  async refreshPortfolio(cx) {
    // Keep authenticated reads sequential: if both discover an expired access
    // token together, two refresh-token rotations could race.
    const account = await get(cx, "/v1/asset/account", { currency: "USD" });
    const positions = await get(cx, "/v1/asset/stock");
    let exchangeRates = null;
    try {
      exchangeRates = await get(cx, "/v1/asset/exchange_rates");
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
    cx.notify();
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
    cx.notify();
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
      cx.notify();
      return;
    }
    if (this.userMenuOpen || this.allocationHelpOpen) {
      this.userMenuOpen = false;
      this.allocationHelpOpen = false;
      cx.notify();
      return;
    }
    const filter = this.page === "portfolio" ? this.holdingsFilter : this.watchlistFilter;
    const query = this.page === "portfolio" ? this.holdingsQuery : this.watchlistQuery;
    if (query) {
      filter.set_value("");
      if (this.page === "portfolio") this.holdingsQuery = "";
      else this.watchlistQuery = "";
      cx.notify();
      return;
    }
    cx.propagate();
  }

  /** @param {LongbridgePage} page @param {import("gpui").Context} cx */
  showPage(page, cx) {
    if (this.page === page) return;
    this.page = page;
    if (page === "portfolio") this.loadPortfolio(cx);
    cx.notify();
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
    cx.notify();
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
    cx.notify();
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
      .child(
        v_flex()
          .w_full()
          .h_full()
          .bg(tokens.background)
          .p(tokens.spacing.sm)
          .gap(tokens.spacing.sm)
          .child(this.header(tokens))
          .child(this.hasStoredTokens ? this.workspace(tokens) : this.loginGate(tokens))
          .child(this.footer(tokens)),
      )
      .child(fps_monitor().anchor("bottom_left"));
  }

  /** @param {import("gpui-base").Theme} tokens */
  header(tokens) {
    return h_flex()
      .items_center()
      .justify_between()
      .gap(tokens.spacing.md)
      .px(tokens.spacing.md)
      .py(tokens.spacing.sm)
      .child(
        h_flex()
          .items_center()
          .gap(tokens.spacing.lg)
          .child(
            image(tokens.appearance === "dark" ? "assets/logo-dark.svg" : "assets/logo-light.svg")
              .w(28)
              .h(28)
              .flex_none()
              .accessibility_label("Longbridge"),
          )
          .child(
            v_flex()
              .gap(tokens.spacing.xxs)
              .child(label(tokens, "Longbridge", 16))
              .child(muted(tokens, "Read-only market terminal")),
          )
          .when(this.hasStoredTokens, (element) =>
            element.child(
              Tabs.new("workspace-tabs")
                .axis("horizontal")
                .flex()
                .items_center()
                .gap(tokens.spacing.xs)
                .child(
                  Tab.new("page-watchlist")
                    .selected(this.page === "watchlist")
                    .on_click((_event, cx) => {
                      this.page = "watchlist";
                      cx.notify();
                    })
                    .flex()
                    .items_center()
                    .justify_center()
                    .h(32)
                    .px(tokens.spacing.sm)
                    .rounded(tokens.radius.sm)
                    .bg(this.page === "watchlist" ? tokens.secondary : tokens.surface)
                    .text_size(11)
                    .font_weight(this.page === "watchlist" ? 600 : 400)
                    .text_color(
                      this.page === "watchlist" ? tokens.foreground : tokens.muted_foreground,
                    )
                    .hover((style) => style.bg(tokens.accent))
                    .focus((style) => style.bg(tokens.accent).text_color(tokens.accent_foreground))
                    .child("Watchlist"),
                )
                .child(
                  Tab.new("page-portfolio")
                    .selected(this.page === "portfolio")
                    .on_click((_event, cx) => {
                      this.page = "portfolio";
                      this.loadPortfolio(cx);
                      cx.notify();
                    })
                    .flex()
                    .items_center()
                    .justify_center()
                    .h(32)
                    .px(tokens.spacing.sm)
                    .rounded(tokens.radius.sm)
                    .bg(this.page === "portfolio" ? tokens.secondary : tokens.surface)
                    .text_size(11)
                    .font_weight(this.page === "portfolio" ? 600 : 400)
                    .text_color(
                      this.page === "portfolio" ? tokens.foreground : tokens.muted_foreground,
                    )
                    .hover((style) => style.bg(tokens.accent))
                    .focus((style) => style.bg(tokens.accent).text_color(tokens.accent_foreground))
                    .child("Portfolio"),
                ),
            ),
          ),
      )
      .child(
        h_flex()
          .items_center()
          .gap(tokens.spacing.sm)
          .child(connectionPill(tokens, this.status.state))
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
      .child(page.flex_1().min_h(0).transition("opacity", { duration: 160, easing: "ease-out" }));
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

  /** @param {import("gpui-base").Theme} tokens */
  watchlistPage(tokens) {
    // The divider is base's, and so is the position it settles at: the group
    // files its panel sizes under its own id, which is why that id is a written
    // name and not one built from anything that changes. Nothing on the view
    // needs to hold the layout for a drag to survive a repaint.
    //
    // A resizable group still cannot wrap, so the switch is between two of
    // them: side by side in a wide window, stacked in a narrow one. Measuring
    // the window is what makes the question answerable — it used to have no
    // answer, and both panes just shrank.
    //
    // Each group files its panel sizes under its own id, which is why those
    // ids are written names and not built from anything that changes.
    const watchlist = this.watchlist(tokens)
      .id("watchlist-pane")
      .size_full()
      .on_mouse_down("right", (_event, cx) => this.copySelectedSymbol(cx));
    const detail = this.stockDetail(tokens).id("stock-detail-pane").size_full();
    if (this.isNarrow()) {
      return v_resizable("watchlist-workspace-stacked")
        .flex_1()
        .min_h(0)
        .gap_1()
        .child(resizable_panel().size(300).size_range(180).child(watchlist))
        .child(resizable_panel().size_range(200).child(detail));
    }
    return h_resizable("watchlist-workspace")
      .flex_1()
      .min_h(0)
      .gap_1()
      .child(resizable_panel().size(620).size_range(360).child(watchlist))
      .child(resizable_panel().size_range(280).child(detail));
  }

  /** @param {import("gpui-base").Theme} tokens */
  watchlist(tokens) {
    const status = streamStatusSummary({ state: this.status.state, delay: this.status.delay });
    const rows = filterRows(this.quotes, this.watchlistQuery, ["code", "name", "symbol"]);
    return panel(tokens)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .px(tokens.spacing.md)
          .py(tokens.spacing.sm)
          .child(v_flex().gap(tokens.spacing.xxs).child(label(tokens, "Watchlist")))
          .child(
            h_flex()
              .items_center()
              .gap(tokens.spacing.sm)
              .child(filterInput(tokens, this.watchlistFilter))
              .child(muted(tokens, status)),
          ),
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
      cx.notify();
    };
    return Popover.new("user-menu")
      .open(this.userMenuOpen)
      .on_open_change((open, cx) => {
        this.userMenuOpen = open;
        cx.notify();
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
    cx.notify();
  }

  /** @param {import("gpui-base").Theme} tokens */
  stockDetail(tokens) {
    const quote =
      this.quotes.find((entry) => entry.symbol === this.selectedSymbol) ?? this.quotes[0];
    return panel(tokens)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .px(tokens.spacing.md)
          .py(tokens.spacing.sm)
          .child(label(tokens, "Stock Details"))
          .child(muted(tokens, "Real-time quote.")),
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
      cx.notify();
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
                  cx.notify();
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
        cx.notify();
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
            cx.notify();
          },
          onMonth: (delta, cx) => {
            if (delta < 0) this.chartCalendar.prev_month();
            else this.chartCalendar.next_month();
            cx.notify();
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
    cx.notify();
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
      .child(
        panel(tokens)
          .flex_none()
          .child(
            h_flex()
              .items_center()
              .justify_between()
              .px(tokens.spacing.md)
              .py(tokens.spacing.sm)
              .child(label(tokens, "Portfolio summary"))
              .child(muted(tokens, account ? `Risk level ${account.risk}` : "Read only")),
          )
          .child(rule(tokens))
          .child(
            account
              ? portfolioSummary(tokens, account, presentation.summaries)
              : emptyPanel(tokens, "No account snapshot", "Waiting for Longbridge account assets."),
          ),
      )
      .when(allocation.slices.length > 0 || allocation.unpriced.length > 0, (element) =>
        element.child(
          panel(tokens)
            .flex_none()
            .child(
              h_flex()
                .items_center()
                .justify_between()
                .px(tokens.spacing.md)
                .py(tokens.spacing.sm)
                .child(label(tokens, "Asset allocation"))
                .child(
                  h_flex()
                    .items_center()
                    .gap(tokens.spacing.sm)
                    .child(muted(tokens, "Market value in USD"))
                    .child(this.allocationHelp(tokens, allocation)),
                ),
            )
            .child(rule(tokens))
            .child(
              h_flex()
                .flex_wrap()
                .items_start()
                .gap(tokens.spacing.xl)
                .p(tokens.spacing.md)
                .child(
                  v_flex().flex_basis(360).flex_grow(1).child(allocationChart(tokens, allocation)),
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
              .child(label(tokens, "Holdings"))
              .child(
                h_flex()
                  .items_center()
                  .gap(tokens.spacing.sm)
                  .child(filterInput(tokens, this.holdingsFilter, 160))
                  .child(
                    muted(
                      tokens,
                      holdingRows.length === this.holdings.length
                        ? `${this.holdings.length} positions`
                        : `${holdingRows.length} of ${this.holdings.length} positions`,
                    ),
                  ),
              ),
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
                    cx.notify();
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
        cx.notify();
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
          .child(label(tokens, "How this chart is built"))
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
                ),
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

  /** @param {import("gpui-base").Theme} tokens */
  footer(tokens) {
    const updated = this.quotes.reduce((latest, quote) => Math.max(latest, quote.receivedAt), 0);
    return h_flex()
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
          // The far corner, because the performance overlay is anchored in the
          // other one and a control underneath it cannot be pressed.
          .child(this.diagnostics(tokens)),
      );
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
      window.appearance(),
      window.is_window_active() ? "active" : "background",
    ];
    if (window.is_fullscreen()) parts.push("fullscreen");
    else if (window.is_maximized()) parts.push("zoomed");
    if (this.isNarrow()) parts.push("stacked");
    return h_flex()
      .items_center()
      .gap(tokens.spacing.sm)
      .child(muted(tokens, parts.join(" · ")))
      .when(Boolean(this.lastKeystroke), (element) =>
        element.child(
          kbd(tokens, this.lastKeystroke, {
            down: this.keyDown,
            held: this.keyHeld,
          }),
        ),
      )
      .when(this.pointerDown, (element) => element.child(kbd(tokens, "mouse-left", { down: true })));
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
        cx.notify();
      })
      .trigger(menuTrigger(tokens, "shell-diagnostics-trigger", "Window diagnostics", this.diagnosticsOpen))
      .content(
        popoverSurface(tokens, { width: 300 })
          .child(label(tokens, "Window"))
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
                [14, 16, 18].map((size) =>
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
