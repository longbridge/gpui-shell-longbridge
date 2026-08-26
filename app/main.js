// A standalone, read-only Longbridge desktop client. OAuth uses direct HTTP,
// quotes use the documented WebSocket protocol, and no trading API is exposed.

import {
  InputState,
  Popover,
  Scrollbar,
  Table,
  TableBody,
  Tab,
  Tabs,
  View,
  clipboard,
  div,
  fps_monitor,
  h_flex,
  h_resizable,
  image,
  resizable_panel,
  set_theme,
  spawn,
  text,
  timer,
  v_flex,
  v_virtual_list,
  with_cx,
} from "gpui";
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
import {
  findNearestPricePoint,
  layoutPriceSeries,
  mergeLiveQuote,
  prepareFiveDaySeries,
} from "./chart.js";
import { allocationInUsd, normalizeUsdRates, portfolioPresentation } from "./portfolio.js";
import {
  action,
  allocationChart,
  connectionPill,
  detailGrid,
  emptyPanel,
  errorMessage,
  externalLink,
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
  muted,
  panel,
  popoverSurface,
  portfolioSummary,
  priceChart,
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
  init() {
    spawn(async () => {
      themes = JSON.parse(await readFile("theme.json"));
      set_theme(themes.dark);
      with_cx((cx) => cx.notify());
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
    this.chartHover = null;
    this.chartPointer = null;
    this.chartHoverFramePending = false;
    this.chartGeneration = 0;
    this.initInteractionState();
    this.clock = timer.every(1_000, (cx) => {
      this.lastTick = Date.now();
      this.quotes = sortLikeTerminal(this.quotes, this.lastTick);
      cx.notify();
    });
    if (this.hasStoredTokens) this.resume();
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
    this.watchlistMenuOpen = false;
    this.allocationHelpOpen = false;
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
      cx.notify();
    });
  }

  /** @param {import("gpui").Context} [cx] */
  resume(cx) {
    this.status = { state: "restoring_token" };
    this.error = "";
    this.streamError = "";
    if (cx) cx.notify();
    spawn(async () => {
      try {
        await this.connect(await accessToken());
      } catch (error) {
        this.status = { state: "error" };
        this.error = error instanceof Error ? error.message : String(error);
        with_cx((next) => next.notify());
      }
    });
  }

  /** @param {import("gpui").Context} cx */
  signIn(cx) {
    if (this.authorization) return;
    this.status = { state: "authorizing" };
    this.error = "";
    cx.notify();
    spawn(async () => {
      try {
        const authorization = await beginDeviceAuthorization();
        this.authorization = authorization;
        with_cx((next) => next.notify());
        const tokens = await pollDeviceAuthorization(authorization);
        this.hasStoredTokens = true;
        this.authorization = null;
        await this.connect(tokens.accessToken);
      } catch (error) {
        this.authorization = null;
        this.status = { state: "error" };
        this.error = error instanceof Error ? error.message : String(error);
        with_cx((next) => next.notify());
      }
    });
  }

  /** @param {string} token */
  async connect(token) {
    this.connectedToken = token;
    const generation = ++this.streamGeneration;
    const previous = this.stream;
    this.stream = null;
    if (previous) await previous.stop();
    if (generation !== this.streamGeneration) return;
    this.status = { state: "loading_watchlist" };
    with_cx((cx) => cx.notify());

    const instruments = watchlistInstruments(await get("/v1/watchlist/groups"));
    if (generation !== this.streamGeneration) return;
    this.instruments = instruments;
    this.quotes = sortLikeTerminal(initialQuotes(instruments), Date.now());
    this.selectedSymbol = instruments[0]?.symbol ?? null;
    // The primary workspace is usable as soon as Watchlist has loaded. Asset
    // reads are a separate, slower boundary and must not leave navigation in a
    // misleading global Connecting state.
    this.status = { state: "connected" };
    with_cx((cx) => cx.notify());
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
      with_cx((cx) => cx.notify());
      this.loadPortfolio();
      return;
    }

    let stream;
    stream = createQuoteStream({
      accessToken: token,
      symbols,
      onQuote: (quote) => {
        if (generation === this.streamGeneration && this.stream === stream)
          this.receiveQuote(quote);
      },
      onStatus: (status) => {
        if (generation === this.streamGeneration && this.stream === stream)
          this.receiveStatus(status);
      },
    });
    this.stream = stream;
    await stream.start();
    if (generation !== this.streamGeneration) {
      await stream.stop();
      return;
    }
    this.loadSelectedChart();
  }

  /** @param {unknown} quote */
  receiveQuote(quote) {
    this.quotes = sortLikeTerminal(
      this.quotes.map((current) => mergeQuote(current, quote)),
      this.lastTick,
    );
    this.portfolioQuotes = this.portfolioQuotes.map((current) => mergeQuote(current, quote));
    if (quote && typeof quote === "object" && quote.symbol === this.selectedSymbol) {
      const candles = this.candleCache.get(this.selectedSymbol);
      if (candles)
        this.candleCache.set(
          this.selectedSymbol,
          mergeLiveQuote(this.selectedSymbol, candles, quote),
        );
      this.quotePulse = 0.72;
      timer.after(160, (cx) => {
        this.quotePulse = 1;
        cx.notify();
      });
    }
    with_cx((cx) => cx.notify());
  }

  loadSelectedChart() {
    const symbol = this.selectedSymbol;
    const stream = this.stream;
    if (!symbol || !stream) return;
    const generation = ++this.chartGeneration;
    this.chartState = {
      symbol,
      state: this.candleCache.has(symbol) ? "ready" : "loading",
    };
    with_cx((cx) => cx.notify());
    const end = new Date();
    const start = new Date(end.getTime() - 14 * 86_400_000);
    const compact = (date) => date.toISOString().slice(0, 10).replaceAll("-", "");
    spawn(async () => {
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
      with_cx((cx) => cx.notify());
    });
  }

  /** @param {unknown} status */
  receiveStatus(status) {
    this.status = status && typeof status === "object" ? status : { state: "error" };
    if (typeof this.status.error === "string") this.streamError = this.status.error;
    else if (this.status.state === "connected") this.streamError = "";
    with_cx((cx) => cx.notify());
  }

  loadPortfolio() {
    spawn(async () => {
      try {
        await this.refreshPortfolio();
        this.error = "";
        with_cx((cx) => cx.notify());
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        with_cx((cx) => cx.notify());
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
    if (themes) set_theme(themes[mode]);
    cx.notify();
  }

  /** @param {string} value @param {string} what */
  copyAuthorization(value, what) {
    clipboard.write_text(value);
    window.push_toast({ title: `${what} copied`, level: "success", id: "authorization-copy" });
  }

  /** @param {import("gpui").Context} cx */
  signOut(cx) {
    const stream = this.stream;
    if (stream) spawn(() => stream.stop());
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
    this.chartHover = null;
    this.chartPointer = null;
    this.chartHoverFramePending = false;
    spawn(async () => {
      await clearTokens();
    });
    cx.notify();
  }

  /** @param {import("gpui").Context} cx */
  render(cx) {
    const tokens = cx.theme();
    return div()
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

  /** @param {import("gpui").Theme} tokens */
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
                    .child(text("Watchlist")),
                )
                .child(
                  Tab.new("page-portfolio")
                    .selected(this.page === "portfolio")
                    .on_click((_event, cx) => {
                      this.page = "portfolio";
                      this.loadPortfolio();
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
                    .child(text("Portfolio")),
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
          ),
      );
  }

  /** @param {import("gpui").Theme} tokens */
  workspace(tokens) {
    // Each page owns its own scrolling. Watchlist is a master-detail layout
    // whose panes scroll independently, and Portfolio is one long column — a
    // shared scroll container above them would either clip the panes or nest a
    // second scroll inside the first, which is what made Holdings unreachable
    // in a short window.
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
      .child(
        (this.page === "portfolio" ? this.portfolioPage(tokens) : this.watchlistPage(tokens))
          .id("workspace-page")
          .flex_1()
          .min_h(0)
          .transition("opacity", { duration: 160, easing: "ease-out" }),
      );
  }

  /** @param {import("gpui").Theme} tokens */
  loginGate(tokens) {
    return h_flex()
      .flex_1()
      .items_center()
      .justify_center()
      .p(tokens.spacing.lg)
      .child(v_flex().w(400).child(this.authPanel(tokens)));
  }

  /** @param {import("gpui").Theme} tokens */
  watchlistPage(tokens) {
    // The divider is base's, and so is the position it settles at: the group
    // files its panel sizes under its own id, which is why that id is a written
    // name and not one built from anything that changes. Nothing on the view
    // needs to hold the layout for a drag to survive a repaint.
    //
    // The panes no longer wrap at narrow widths — a resizable group cannot, and
    // the runtime exposes no window width to switch on — so each carries a
    // minimum instead and a short window shrinks them rather than stacking.
    return h_resizable("watchlist-workspace")
      .flex_1()
      .min_h(0)
      .gap_1()
      .child(
        resizable_panel()
          .size(620)
          .size_range(360)
          .child(this.watchlist(tokens).id("watchlist-pane").size_full()),
      )
      .child(
        resizable_panel()
          .size_range(280)
          .child(this.stockDetail(tokens).id("stock-detail-pane").size_full()),
      );
  }

  /** @param {import("gpui").Theme} tokens */
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
              .child(muted(tokens, status))
              .child(this.watchlistMenu(tokens)),
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
          (index, cx) => this.selectQuote(rows, index, cx),
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
   * @param {import("gpui").Theme} tokens
   * @param {string} id
   * @param {string} name
   * @param {any[]} rows
   * @param {number} rowHeight
   * @param {import("gpui").Element} header
   * @param {(row: any, index: number) => import("gpui").Element} renderRow
   * @param {((index: number, cx: import("gpui").Context) => void) | null} onSelect
   * @param {import("gpui").Element} empty
   */
  instrumentTable(tokens, id, name, rows, rowHeight, header, renderRow, onSelect, empty) {
    const body = TableBody.new(`${id}-body`)
      .relative()
      .flex_1()
      .min_h(0)
      .child(
        // The renderer runs inside layout, so it registers nothing: selection
        // is the list's own `on_item_click`, reported as an index into the
        // rows this render was built from — which is the filtered list, not
        // the whole collection.
        v_virtual_list(`${id}-rows`, rows.length, rowHeight, (range) =>
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
   * The Watchlist popup menu.
   *
   * `Popover` owns the press, the anchoring and the dismissal; the rows are
   * ordinary buttons carrying the menu-item role, because the runtime binds no
   * menu component to build them from.
   *
   * @param {import("gpui").Theme} tokens
   */
  watchlistMenu(tokens) {
    const selected = this.quotes.find((quote) => quote.symbol === this.selectedSymbol);
    const close = (cx) => {
      this.watchlistMenuOpen = false;
      cx.notify();
    };
    return Popover.new("watchlist-menu")
      .open(this.watchlistMenuOpen)
      .on_open_change((open, cx) => {
        this.watchlistMenuOpen = open;
        cx.notify();
      })
      .trigger(
        menuTrigger(tokens, "watchlist-menu-trigger", "Watchlist actions", this.watchlistMenuOpen),
      )
      .content(
        popoverSurface(tokens, { menu: true })
          .child(
            menuItem(tokens, "watchlist-menu-reconnect", "Reconnect stream", (_event, cx) => {
              close(cx);
              this.resume(cx);
            }),
          )
          .child(
            menuItem(
              tokens,
              "watchlist-menu-copy-symbol",
              "Copy selected symbol",
              (_event, cx) => {
                close(cx);
                if (selected) this.copyAuthorization(selected.symbol, "Symbol");
              },
              { detail: selected ? selected.code : "", disabled: !selected },
            ),
          )
          .child(
            menuItem(
              tokens,
              "watchlist-menu-refresh-chart",
              "Reload 5D chart",
              (_event, cx) => {
                close(cx);
                this.candleCache.delete(this.selectedSymbol);
                this.loadSelectedChart();
              },
              { disabled: !selected },
            ),
          )
          .child(rule(tokens))
          .child(
            menuItem(
              tokens,
              "watchlist-menu-theme",
              tokens.appearance === "dark" ? "Light theme" : "Dark theme",
              (_event, cx) => {
                close(cx);
                this.chooseTheme(tokens.appearance === "dark" ? "light" : "dark", cx);
              },
            ),
          )
          .child(rule(tokens))
          .child(
            // The only way out while signed in: the sign-in card is not on
            // screen once a session is live, so its "Clear session" cannot be
            // reached from here.
            menuItem(
              tokens,
              "watchlist-menu-sign-out",
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
   * @param {any[]} rows The rows this render drew, which is what the index is into.
   * @param {number} index
   * @param {import("gpui").Context} cx
   */
  selectQuote(rows, index, cx) {
    const quote = rows[index];
    if (!quote || quote.symbol === this.selectedSymbol) return;
    this.selectedSymbol = quote.symbol;
    this.loadSelectedChart();
    cx.notify();
  }

  /** @param {import("gpui").Theme} tokens */
  stockDetail(tokens) {
    const quote =
      this.quotes.find((entry) => entry.symbol === this.selectedSymbol) ?? this.quotes[0];
    const series = quote
      ? prepareFiveDaySeries(quote.symbol, this.candleCache.get(quote.symbol) ?? [])
      : { symbol: "", days: [], points: [] };
    const geometry = layoutPriceSeries(series, { width: 480, height: 132, dayGap: 8 });
    const hoveredPoint =
      this.chartHover?.symbol === quote?.symbol
        ? geometry.points.find((point) => point.timestamp === this.chartHover.timestamp) ?? null
        : null;
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
              .child(quoteDetail(tokens, quote, this.lastTick, this.quotePulse ?? 1))
              .child(
                v_flex()
                  .px(tokens.spacing.lg)
                  .pb(tokens.spacing.lg)
                  .child(
                    priceChart(
                      tokens,
                      geometry,
                      this.chartState.symbol === quote.symbol ? this.chartState.state : "loading",
                      hoveredPoint,
                      (event) => {
                        const width = event.bounds.width;
                        if (!(width > 0)) return;
                        this.chartPointer = {
                          symbol: quote.symbol,
                          x: (event.local_position.x / width) * geometry.width,
                        };
                        if (this.chartHoverFramePending) return;
                        this.chartHoverFramePending = true;
                        timer.after(16, (cx) => {
                          this.chartHoverFramePending = false;
                          const pointer = this.chartPointer;
                          if (!pointer || pointer.symbol !== quote.symbol) return;
                          const point = findNearestPricePoint(geometry, pointer.x);
                          if (!point || this.chartHover?.timestamp === point.timestamp) return;
                          this.chartHover = { symbol: quote.symbol, timestamp: point.timestamp };
                          cx.notify();
                        });
                      },
                      (hovered, cx) => {
                        if (hovered) return;
                        this.chartPointer = null;
                        if (this.chartHover === null) return;
                        this.chartHover = null;
                        cx.notify();
                      },
                    ),
                  ),
              )
          : emptyPanel(
              tokens,
              "Watchlist is empty",
              "Add securities in Longbridge, then reconnect to refresh this read-only view.",
            ),
      );
  }

  /** @param {import("gpui").Theme} tokens */
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
              // claim. So the body is as tall as its rows up to a ceiling, and
              // the page scrolls past the panel once it hits it.
              .h(
                TABLE_HEADER_HEIGHT +
                  Math.min(holdingRows.length, HOLDINGS_VIEWPORT_ROWS) * HOLDING_ROW_HEIGHT,
              )
              .when(holdingRows.length === 0, (element) => element.h_auto()),
          ),
      );
  }

  /**
   * The second `Popover` in the application, and deliberately a different
   * shape from the Watchlist menu: a card of explanatory text rather than a
   * list of commands, so it announces itself as a group and not a menu.
   *
   * @param {import("gpui").Theme} tokens
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
   * @param {import("gpui").Theme} tokens
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
   * @param {import("gpui").Theme} tokens
   * @param {{ userCode: string, verificationUri: string }} device
   */
  deviceCode(tokens, device) {
    return v_flex()
      .gap(tokens.spacing.sm)
      .child(step(tokens, 1, "Open the authorization page"))
      .child(
        h_flex()
          .justify_center()
          .child(
            externalLink(
              tokens,
              "open-authorization-link",
              device.verificationUri,
              device.verificationUri,
            ),
          ),
      )
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
              () => this.copyAuthorization(device.userCode, "Device code"),
              { variant: "ghost" },
            ).flex_1(),
          )
          .child(
            action(
              tokens,
              "copy-authorization-link",
              "Copy link",
              () => this.copyAuthorization(device.verificationUri, "Authorization link"),
              { variant: "ghost" },
            ).flex_1(),
          ),
      );
  }

  /** @param {import("gpui").Theme} tokens */
  footer(tokens) {
    const updated = this.quotes.reduce((latest, quote) => Math.max(latest, quote.receivedAt), 0);
    return h_flex()
      .items_center()
      .justify_between()
      .px(tokens.spacing.sm)
      .child(muted(tokens, "Read only · Trading disabled"))
      .child(
        muted(
          tokens,
          updated
            ? `Last tick ${Math.max(0, Math.floor((this.lastTick - updated) / 1_000))}s ago`
            : "Awaiting quotes",
        ),
      );
  }
}
