// A standalone, read-only Longbridge desktop client. OAuth uses direct HTTP,
// quotes use the documented WebSocket protocol, and no trading API is exposed.

import { View, clipboard, h_flex, image, set_theme, spawn, timer, v_flex, with_cx } from "gpui";
import {
  accessToken,
  beginDeviceAuthorization,
  clearTokens,
  loadTokens,
  pollDeviceAuthorization,
} from "./auth.js";
import { get } from "./http.js";
import {
  initialQuotes,
  mergeQuote,
  sortLikeTerminal,
  streamStatusSummary,
  watchlistInstruments,
} from "./market.js";
import { createQuoteStream } from "./quote_stream.js";
import { portfolioPresentation } from "./portfolio.js";
import {
  action,
  connectionPill,
  emptyPanel,
  errorMessage,
  externalLink,
  holdingRow,
  holdingsHeader,
  label,
  muted,
  panel,
  portfolioSummary,
  quoteDetail,
  quoteRow,
  rule,
  themeButton,
  watchlistHeader,
} from "./ui.js";

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
    /** @type {LongbridgeHoldingRow[]} */
    this.holdings = [];
    this.error = "";
    this.streamError = "";
    this.stream = null;
    this.streamGeneration = 0;
    this.connectedToken = null;
    this.lastTick = Date.now();
    this.quotePulse = 1;
    this.clock = timer.every(1_000, (cx) => {
      this.lastTick = Date.now();
      this.quotes = sortLikeTerminal(this.quotes, this.lastTick);
      cx.notify();
    });
    if (this.hasStoredTokens) this.resume();
  }

  /** @param {import("gpui").Context} [cx] */
  resume(cx) {
    this.status = { state: "connecting" };
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
    this.status = { state: "connecting" };
    with_cx((cx) => cx.notify());

    const instruments = watchlistInstruments(await get("/v1/watchlist/groups"));
    if (generation !== this.streamGeneration) return;
    this.instruments = instruments;
    this.quotes = sortLikeTerminal(initialQuotes(instruments), Date.now());
    this.selectedSymbol = instruments[0]?.symbol ?? null;
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
  }

  /** @param {unknown} quote */
  receiveQuote(quote) {
    this.quotes = sortLikeTerminal(
      this.quotes.map((current) => mergeQuote(current, quote)),
      this.lastTick,
    );
    this.portfolioQuotes = this.portfolioQuotes.map((current) => mergeQuote(current, quote));
    if (quote && typeof quote === "object" && quote.symbol === this.selectedSymbol) {
      this.quotePulse = 0.72;
      timer.after(160, (cx) => {
        this.quotePulse = 1;
        cx.notify();
      });
    }
    with_cx((cx) => cx.notify());
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
    const account = await get("/v1/asset/account");
    const positions = await get("/v1/asset/stock");
    this.account = firstRecord(account);
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
    set_theme(mode);
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
    this.holdings = [];
    this.status = { state: "offline" };
    this.streamError = "";
    this.hasStoredTokens = false;
    this.instruments = [];
    this.quotes = [];
    this.portfolioQuotes = [];
    this.selectedSymbol = null;
    spawn(async () => {
      await clearTokens();
    });
    cx.notify();
  }

  /** @param {import("gpui").Context} cx */
  render(cx) {
    const tokens = cx.theme();
    return v_flex()
      .size_full()
      .bg(tokens.background)
      .p(tokens.spacing.sm)
      .gap(tokens.spacing.sm)
      .child(this.header(tokens))
      .child(this.hasStoredTokens ? this.workspace(tokens) : this.loginGate(tokens))
      .child(this.footer(tokens));
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
            image(tokens.mode === "dark" ? "assets/logo-dark.svg" : "assets/logo-light.svg")
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
              h_flex()
                .items_center()
                .gap(tokens.spacing.xs)
                .child(
                  action(
                    tokens,
                    "page-watchlist",
                    "Watchlist",
                    (_event, cx) => {
                      this.page = "watchlist";
                      cx.notify();
                    },
                    { variant: "ghost", selected: this.page === "watchlist" },
                  ),
                )
                .child(
                  action(
                    tokens,
                    "page-portfolio",
                    "Portfolio",
                    (_event, cx) => {
                      this.page = "portfolio";
                      this.loadPortfolio();
                      cx.notify();
                    },
                    { variant: "ghost", selected: this.page === "portfolio" },
                  ),
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
              this.chooseTheme(tokens.mode === "dark" ? "light" : "dark", cx),
            ),
          ),
      );
  }

  /** @param {import("gpui").Theme} tokens */
  workspace(tokens) {
    return v_flex()
      .flex_1()
      .min_h(0)
      .gap(tokens.spacing.sm)
      .when(Boolean(this.error), (element) => element.child(errorMessage(tokens, this.error)))
      .child(
        (this.page === "portfolio" ? this.portfolioPage(tokens) : this.watchlistPage(tokens))
          .id("workspace-page")
          .transition("opacity", { duration: 160, easing: "ease-out" }),
      );
  }

  /** @param {import("gpui").Theme} tokens */
  loginGate(tokens) {
    return h_flex()
      .flex_1()
      .items_center()
      .justify_center()
      .child(v_flex().w(520).child(this.authPanel(tokens, false)));
  }

  /** @param {import("gpui").Theme} tokens */
  watchlistPage(tokens) {
    return h_flex()
      .items_stretch()
      .flex_1()
      .min_h(0)
      .flex_wrap()
      .gap(tokens.spacing.sm)
      .overflow_y_scrollbar()
      .child(
        this.watchlist(tokens)
          .id("watchlist-pane")
          .flex_basis(560)
          .flex_grow(1)
          .min_w(360)
          .h_full(),
      )
      .child(
        this.stockDetail(tokens)
          .id("stock-detail-pane")
          .flex_basis(300)
          .flex_grow(1)
          .min_w(280)
          .h_full(),
      );
  }

  /** @param {import("gpui").Theme} tokens */
  watchlist(tokens) {
    const status = streamStatusSummary({ state: this.status.state, delay: this.status.delay });
    return panel(tokens)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .px(tokens.spacing.md)
          .py(tokens.spacing.sm)
          .child(v_flex().gap(tokens.spacing.xxs).child(label(tokens, "Watchlist")))
          .child(muted(tokens, status)),
      )
      .child(rule(tokens))
      .when(Boolean(this.streamError), (element) =>
        element.child(errorMessage(tokens, streamStatusSummary(this.status))),
      )
      .child(watchlistHeader(tokens))
      .child(rule(tokens))
      .child(
        v_flex()
          .id("watchlist-scroll")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .children(
            this.quotes.map((quote) =>
              quoteRow(
                tokens,
                quote,
                quote.symbol === this.selectedSymbol,
                (_event, cx) => {
                  this.selectedSymbol = quote.symbol;
                  cx.notify();
                },
                this.lastTick,
              ),
            ),
          ),
      );
  }

  /** @param {import("gpui").Theme} tokens */
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
          ? quoteDetail(tokens, quote, this.lastTick, this.quotePulse ?? 1)
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
    const presentation = portfolioPresentation(this.holdings, [
      ...this.quotes,
      ...this.portfolioQuotes,
    ]);
    const account = balance
      ? {
          netAssets: stringValue(balance.net_assets ?? balance.netAssets),
          totalCash: stringValue(balance.total_cash ?? balance.totalCash),
          buyingPower: stringValue(balance.buy_power ?? balance.buyPower),
          currency: stringValue(balance.currency),
          risk: stringValue(balance.risk_level ?? balance.riskLevel),
        }
      : null;

    return v_flex()
      .flex_1()
      .min_h(0)
      .gap(tokens.spacing.md)
      .child(
        panel(tokens)
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
      .child(
        panel(tokens)
          .flex_1()
          .child(
            h_flex()
              .items_center()
              .justify_between()
              .px(tokens.spacing.md)
              .py(tokens.spacing.sm)
              .child(label(tokens, "Holdings"))
              .child(muted(tokens, `${this.holdings.length} positions`)),
          )
          .child(rule(tokens))
          .child(holdingsHeader(tokens))
          .child(rule(tokens))
          .child(
            this.holdings.length
              ? v_flex()
                  .id("holdings-scroll")
                  .flex_1()
                  .min_h(0)
                  .overflow_y_scrollbar()
                  .children(presentation.holdings.map((holding) => holdingRow(tokens, holding)))
              : emptyPanel(
                  tokens,
                  "No stock positions",
                  "This account currently reports no stock holdings.",
                ),
          ),
      );
  }

  /** @param {import("gpui").Theme} tokens @param {boolean} connected */
  authPanel(tokens, connected) {
    const device = this.authorization;
    const stored = this.hasStoredTokens;
    const needsAttention = stored && this.status.state === "error";
    const title = connected
      ? "Connected"
      : needsAttention
        ? "Session needs attention"
        : stored
          ? "Restoring session"
          : "Sign in required";
    const detail = connected
      ? "Quotes and account data are read-only."
      : needsAttention
        ? "Retry the saved session or clear it to sign in again."
        : stored
          ? "Reconnecting with the saved Longbridge session."
          : "Authorize this device with your Longbridge account.";
    return panel(tokens)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .px(tokens.spacing.md)
          .py(tokens.spacing.sm)
          .child(label(tokens, "Access"))
          .child(
            muted(
              tokens,
              connected ? "ACTIVE" : device ? "DEVICE CODE" : stored ? "SESSION" : "DEVICE CODE",
            ),
          ),
      )
      .child(rule(tokens))
      .child(
        v_flex()
          .gap(tokens.spacing.sm)
          .p(tokens.spacing.md)
          .child(device ? this.deviceCode(tokens, device) : emptyPanel(tokens, title, detail))
          .when(Boolean(this.error), (element) => element.child(errorMessage(tokens, this.error)))
          .child(
            h_flex()
              .gap(tokens.spacing.sm)
              .child(
                action(
                  tokens,
                  "longbridge-sign-in",
                  device
                    ? "Waiting for approval"
                    : connected
                      ? "Refresh portfolio"
                      : stored
                        ? "Retry connection"
                        : "Sign in",
                  (_event, cx) =>
                    connected ? this.loadPortfolio() : stored ? this.resume(cx) : this.signIn(cx),
                  {
                    variant: connected || stored ? "default" : "primary",
                    disabled: Boolean(device),
                  },
                ),
              )
              .when(stored, (element) =>
                element.child(
                  action(
                    tokens,
                    "longbridge-sign-out",
                    "Clear session",
                    (_event, cx) => this.signOut(cx),
                    { variant: "destructive", quiet: true },
                  ),
                ),
              ),
          ),
      );
  }

  /** @param {import("gpui").Theme} tokens @param {{ userCode: string, verificationUri: string }} device */
  deviceCode(tokens, device) {
    return v_flex()
      .gap(tokens.spacing.xs)
      .child(label(tokens, device.userCode || "Open authorization link", 16))
      .child(muted(tokens, device.verificationUri))
      .child(
        externalLink(
          tokens,
          "open-authorization-link",
          "Open Longbridge authorization",
          device.verificationUri,
        ),
      )
      .child(
        h_flex()
          .gap(tokens.spacing.sm)
          .child(
            action(
              tokens,
              "copy-authorization-link",
              "Copy link",
              () => this.copyAuthorization(device.verificationUri, "Authorization link"),
              { variant: "ghost" },
            ),
          )
          .child(
            action(
              tokens,
              "copy-device-code",
              "Copy code",
              () => this.copyAuthorization(device.userCode, "Device code"),
              { variant: "ghost" },
            ),
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
