// Compact presentation primitives for the read-only terminal. Every visual
// decision resolves from the call-scoped semantic theme.

import {
  Background,
  Button,
  Input,
  Link,
  PathBuilder,
  Progress,
  ProgressIndicator,
  ProgressTrack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  div,
  h_flex,
  paint_path,
  svg,
  text,
  v_flex,
} from "gpui";
import { formatCompactNumber, quoteFreshness, tradeStatusLabel } from "./market.js";
import { foldAllocationSlices } from "./portfolio.js";

/** @param {import("gpui").Theme} tokens @param {string | number} value @param {number} [size] */
export const label = (tokens, value, size = 12) =>
  text(value).text_size(size).line_height(1.25).text_color(tokens.foreground);

/** @param {import("gpui").Theme} tokens @param {string | number} value @param {number} [size] */
export const numeric = (tokens, value, size = 12) =>
  label(tokens, value, size).font_family("monospace");

/** @param {import("gpui").Theme} tokens @param {string | number} value */
export const muted = (tokens, value) =>
  text(value).text_size(11).line_height(1.25).text_color(tokens.muted_foreground);

/** @param {import("gpui").Theme} tokens */
export const rule = (tokens) => div().w_full().h(1).bg(tokens.border);

/** @param {import("gpui").Theme} tokens */
export const panel = (tokens) =>
  v_flex()
    .bg(tokens.surface)
    .border(1)
    .border_color(tokens.border)
    .rounded(tokens.radius.md)
    .overflow_hidden();

/**
 * @param {import("gpui").Theme} tokens
 * @param {string} id
 * @param {string} caption
 * @param {(event: import("gpui").ClickEvent, cx: import("gpui").Context) => void} onClick
 * @param {{ variant?: LongbridgeActionVariant, disabled?: boolean, selected?: boolean, quiet?: boolean }} [options]
 */
export function action(tokens, id, caption, onClick, options = {}) {
  const { variant = "default", disabled = false, selected = false, quiet = false } = options;
  const primary = variant === "primary";
  const destructive = variant === "destructive";
  const ghost = variant === "ghost" || quiet;
  const background = selected
    ? tokens.accent
    : primary
      ? tokens.primary
      : destructive && !quiet
        ? tokens.destructive
        : tokens.surface;
  const foreground = selected
    ? tokens.accent_foreground
    : primary
      ? tokens.primary_foreground
      : destructive
        ? quiet
          ? tokens.destructive
          : tokens.destructive_foreground
        : tokens.foreground;
  const border = ghost
    ? tokens.surface
    : selected || primary
      ? tokens.primary
      : destructive
        ? tokens.destructive
        : tokens.border;

  return Button.new(id)
    .disabled(disabled)
    .selected(selected)
    .flex()
    .items_center()
    .justify_center()
    .h(28)
    .px(tokens.spacing.sm)
    .rounded(tokens.radius.sm)
    .border(ghost ? 0 : 1)
    .border_color(border)
    .bg(background)
    .text_size(11)
    .text_color(foreground)
    .transition("opacity", { duration: 120, easing: "ease-out" })
    .focus((style) => style.bg(tokens.accent).text_color(tokens.accent_foreground))
    .when(!disabled, (element) =>
      element.on_click(onClick).hover((style) => {
        if (primary)
          return style.bg(tokens.primary).text_color(tokens.primary_foreground).opacity(0.88);
        if (destructive && !quiet)
          return style
            .bg(tokens.destructive)
            .text_color(tokens.destructive_foreground)
            .opacity(0.88);
        if (destructive) return style.bg(tokens.muted).text_color(tokens.destructive);
        return style.bg(tokens.accent).text_color(tokens.accent_foreground);
      }),
    )
    .when(disabled, (element) => element.opacity(0.42))
    .child(text(caption));
}

/**
 * @param {import("gpui").Theme} tokens
 * @param {(event: import("gpui").ClickEvent, cx: import("gpui").Context) => void} onClick
 */
export function themeButton(tokens, onClick) {
  const dark = tokens.appearance === "dark";
  const hint = dark ? "Switch to light theme" : "Switch to dark theme";
  return Button.new("theme-toggle")
    .accessibility_label(hint)
    .tooltip(hint)
    .on_click(onClick)
    .flex()
    .items_center()
    .justify_center()
    .w(24)
    .h(24)
    .rounded(tokens.radius.sm)
    .border(0)
    .text_color(tokens.muted_foreground)
    .transition("opacity", { duration: 120, easing: "ease-out" })
    .hover((style) => style.bg(tokens.accent).text_color(tokens.accent_foreground))
    .focus((style) => style.bg(tokens.accent).text_color(tokens.accent_foreground))
    .child(
      svg(dark ? "assets/sun.svg" : "assets/moon.svg")
        .w(12)
        .h(12)
        .flex_none(),
    );
}

/** @param {import("gpui").Theme} tokens @param {string} id @param {string} caption @param {string} url */
export function externalLink(tokens, id, caption, url) {
  return Link.new(id)
    .href(url)
    .cursor_pointer()
    .text_size(12)
    .text_color(tokens.primary)
    .border_b(1)
    .border_color(tokens.primary)
    .focus((style) =>
      style.bg(tokens.accent).text_color(tokens.accent_foreground).border_color(tokens.ring),
    )
    .child(text(caption));
}

/** @param {import("gpui").Theme} tokens @param {string} value */
export function connectionPill(tokens, value) {
  const active = value === "connected";
  const waiting =
    value === "authorizing" ||
    value === "connecting" ||
    value === "authenticating" ||
    value === "subscribing" ||
    value === "snapshotting" ||
    value === "reconnecting";
  const color = active
    ? tokens.primary
    : waiting
      ? tokens.primary
      : value === "error"
        ? tokens.destructive
        : tokens.muted_foreground;
  return h_flex()
    .id("connection-state")
    .items_center()
    .gap(tokens.spacing.xs)
    .tooltip(`Quote stream: ${value}`)
    .opacity(waiting ? 0.72 : 1)
    .transition("opacity", { duration: 180, easing: "ease-out" })
    .child(div().w(6).h(6).rounded(tokens.radius.full).bg(color))
    .child(
      muted(
        tokens,
        active
          ? "Live"
          : waiting
            ? "Connecting"
            : value === "error"
              ? "Needs attention"
              : "Offline",
      ),
    );
}

// What each abbreviated column actually reports. A tooltip takes a string
// rather than an element, and it is the pointer's affordance only — the
// accessible name is the visible header text itself.
const COLUMN_HINTS = Object.freeze({
  Instrument: "Ticker and security name",
  Last: "Most recent traded price",
  Change: "Move against the previous close, absolute and percent",
  Volume: "Shares traded so far this session",
  Session: "Trading status, or the session the quote came from",
  Quantity: "Shares held, and how many of them are available",
  "Last / Cost": "Latest price over the average cost of the position",
  "Today's P/L": "Move since the previous close, in USD",
  "Total P/L": "Move against cost, in USD and percent",
});

/**
 * The height a table's header row is drawn at, stated for the same reason the
 * row heights are: a virtualized body sized against a ceiling has to know how
 * much of the panel the header above it already took.
 */
export const TABLE_HEADER_HEIGHT = 24;

/**
 * A table's header row group. `TableHead` carries a one-based column index
 * because a cell that does not know its column announces itself out of place.
 *
 * @param {import("gpui").Theme} tokens
 * @param {string} id
 * @param {{ title: string, size: (el: import("gpui").Element) => import("gpui").Element }[]} columns
 */
function tableHeaderRow(tokens, id, columns) {
  return TableHeader.new(`${id}-header`)
    .child(
      // Row one of the table's rows: the body rows below start at two, the way
      // an accessible row index counts every row including this one.
      TableRow.new(`${id}-header-row`, 1)
        .flex()
        .items_center()
        .h(TABLE_HEADER_HEIGHT)
        .gap(tokens.spacing.sm)
        .px(tokens.spacing.sm)
        .bg(tokens.muted)
        .border_b(1)
        .border_color(tokens.border)
        .children(
          columns.map((column, index) =>
            column
              .size(
                TableHead.new(`${id}-head-${index + 1}`, index + 1)
                  .flex()
                  .items_center()
                  .tooltip(COLUMN_HINTS[column.title] ?? column.title),
              )
              .child(muted(tokens, column.title)),
          ),
        ),
    );
}

const WATCHLIST_COLUMNS = [
  { title: "Instrument", size: (el) => el.w("31%") },
  { title: "Last", size: (el) => el.w("19%").justify_end() },
  { title: "Change", size: (el) => el.w("18%").justify_end() },
  { title: "Volume", size: (el) => el.w("16%").justify_end() },
  { title: "Session", size: (el) => el.flex_1().justify_end() },
];

/** @param {import("gpui").Theme} tokens */
export function watchlistHeader(tokens) {
  return tableHeaderRow(tokens, "watchlist", WATCHLIST_COLUMNS);
}

/**
 * One row of a popup menu.
 *
 * gpui-shell binds no menu component of its own: `Popover` is the anchored
 * surface, and what goes inside it belongs to the application. So a menu is a
 * `Button` per row carrying the menu-item role — which is what makes it a menu
 * to a screen reader and not only to a reader of this file.
 *
 * @param {import("gpui").Theme} tokens
 * @param {string} id
 * @param {string} caption
 * @param {(event: import("gpui").ClickEvent, cx: import("gpui").Context) => void} onClick
 * @param {{ detail?: string, destructive?: boolean, disabled?: boolean }} [options]
 */
export function menuItem(tokens, id, caption, onClick, options = {}) {
  const { detail = "", destructive = false, disabled = false } = options;
  const foreground = destructive ? tokens.destructive : tokens.foreground;
  return Button.new(id)
    .role("menu_item")
    .disabled(disabled)
    .on_click(onClick)
    .flex()
    .items_center()
    .justify_between()
    .gap(tokens.spacing.md)
    .w_full()
    .px(tokens.spacing.sm)
    .py(tokens.spacing.xs)
    .rounded(tokens.radius.sm)
    .border(0)
    .bg(tokens.surface)
    .text_color(foreground)
    .opacity(disabled ? 0.5 : 1)
    .hover((style) => style.bg(tokens.accent))
    .focus((style) => style.bg(tokens.accent))
    .child(label(tokens, caption))
    .when(Boolean(detail), (element) => element.child(muted(tokens, detail)));
}

/**
 * The surface a `Popover` opens. `role` separates the two uses: a list of
 * commands announces itself as a menu, an explanatory card as a plain group.
 *
 * @param {import("gpui").Theme} tokens
 * @param {{ width?: number, menu?: boolean }} [options]
 */
export function popoverSurface(tokens, options = {}) {
  const { width = 240, menu = false } = options;
  return v_flex()
    .when(menu, (element) => element.role("menu"))
    .w(width)
    .gap(menu ? tokens.spacing.xxs : tokens.spacing.sm)
    .p(menu ? tokens.spacing.xs : tokens.spacing.md)
    .bg(tokens.surface)
    .border(1)
    .border_color(tokens.border)
    .rounded(tokens.radius.md);
}

/**
 * The frame around a list's filter box.
 *
 * A filter is the one text input a read-only terminal has: it narrows what is
 * already on screen and reaches nothing outside the window. The state it draws
 * lives on the view — `InputState.new()` needs a live host call and belongs in
 * `init`, never in a render.
 *
 * @param {import("gpui").Theme} tokens
 * @param {import("gpui").InputStateHandle} state
 * @param {number} [width]
 */
export function filterInput(tokens, state, width = 180) {
  return Input.new(state)
    .w(width)
    .h(26)
    .px(tokens.spacing.sm)
    .rounded(tokens.radius.sm)
    .border(1)
    .border_color(tokens.border)
    .bg(tokens.surface)
    .text_size(11)
    .text_color(tokens.foreground)
    .focus((style) => style.border_color(tokens.ring));
}

/**
 * The `⋯` control a popup menu or a popover hangs from. Icon-only, which is
 * the case a tooltip exists for.
 *
 * `open` is not decoration, and it has to be drawn differently from focus
 * rather than with the same fill. A `Popover` takes the keyboard into its
 * surface while it is up and hands it back to the trigger when it dismisses,
 * so a trigger whose focus style is the open style reads the state backwards
 * in both directions: flat while the menu shows, then lit once it is gone.
 *
 * So the two are different marks. Open is a filled control. Focus is a ring —
 * where the keyboard is, which is a different question from whether the menu
 * is up — and it changes no fill, so a trigger that is open *and* focused
 * still reads as open. The border is always there and only changes color, so
 * the ring never moves the icon.
 *
 * @param {import("gpui").Theme} tokens
 * @param {string} id
 * @param {string} hint
 * @param {boolean} [open]
 */
export function menuTrigger(tokens, id, hint, open = false) {
  return Button.new(id)
    .accessibility_label(hint)
    .tooltip(hint)
    .selected(open)
    .flex()
    .items_center()
    .justify_center()
    .w(24)
    .h(24)
    .rounded(tokens.radius.sm)
    .border(1)
    .border_color(open ? tokens.accent : tokens.surface)
    .bg(open ? tokens.accent : tokens.surface)
    .text_color(open ? tokens.accent_foreground : tokens.muted_foreground)
    .hover((style) => style.bg(tokens.accent).text_color(tokens.accent_foreground))
    .focus((style) => style.border_color(tokens.ring))
    .child(label(tokens, "\u22ef", 14));
}

/**
 * The height every watchlist row is drawn at, and the size the virtual list
 * hands GPUI for each of them. The two have to agree exactly — the list places
 * rows from this number without measuring them — so the row states it rather
 * than letting padding and two lines of type add up to whatever they add up to.
 */
export const QUOTE_ROW_HEIGHT = 44;

/**
 * A watchlist row, as a table row rather than a button that looks like one.
 *
 * It registers no click handler of its own: rows are rebuilt every frame the
 * virtual list is scrolled, and a per-row callback would accumulate one
 * unreachable function per row per frame. The list carries a single
 * `on_item_click` instead and reports the index.
 *
 * `rowIndex` is the row's zero-based position in the whole collection; what is
 * announced is that plus two, because the header above it is row one.
 *
 * @param {import("gpui").Theme} tokens
 * @param {LongbridgeQuoteRow} quote
 * @param {boolean} selected
 * @param {number} rowIndex
 * @param {number} [now]
 */
export function quoteRow(tokens, quote, selected, rowIndex = 0, now = Date.now()) {
  const tone = quote.change.startsWith("-")
    ? tokens.destructive
    : quote.change.startsWith("+")
      ? tokens.primary
      : tokens.foreground;
  const cell = (column, build) =>
    build(TableCell.new(`quote-${quote.symbol}-${column}`, column));
  return TableRow.new(`quote-${quote.symbol}`, rowIndex + 2)
    .flex()
    .items_center()
    .w_full()
    .h(QUOTE_ROW_HEIGHT)
    .gap(tokens.spacing.sm)
    .px(tokens.spacing.sm)
    .py(tokens.spacing.xs)
    .border_b(1)
    .border_color(tokens.border)
    .bg(selected ? tokens.accent : tokens.surface)
    .opacity(quote.receivedAt ? 1 : 0.68)
    .transition("opacity", { duration: 160, easing: "ease-out" })
    .text_color(selected ? tokens.accent_foreground : tokens.foreground)
    .hover((style) => style.bg(tokens.accent).text_color(tokens.accent_foreground))
    .child(
      cell(1, (element) =>
        element
          .flex()
          .flex_col()
          .w("31%")
          .gap(tokens.spacing.xxs)
          .child(label(tokens, quote.code))
          .child(muted(tokens, quote.name)),
      ),
    )
    .child(
      cell(2, (element) =>
        element.flex().w("19%").justify_end().child(numeric(tokens, quote.last)),
      ),
    )
    .child(
      cell(3, (element) =>
        element
          .flex()
          .flex_col()
          .w("18%")
          .items_end()
          .gap(tokens.spacing.xxs)
          .child(numeric(tokens, quote.changePercent).text_color(tone))
          .child(numeric(tokens, quote.change).text_color(tone)),
      ),
    )
    .child(
      cell(4, (element) =>
        element
          .flex()
          .w("16%")
          .justify_end()
          .child(muted(tokens, formatCompactNumber(quote.volume))),
      ),
    )
    .child(
      cell(5, (element) =>
        element.flex().flex_1().justify_end().child(muted(tokens, tradeStatusLabel(quote))),
      ),
    );
}

function quoteTone(tokens, change) {
  return change.startsWith("-")
    ? tokens.destructive
    : change.startsWith("+")
      ? tokens.primary
      : tokens.foreground;
}

function marketTime(timestamp) {
  if (!timestamp) return "--";
  return `${new Date(timestamp).toISOString().slice(11, 19)} UTC`;
}

function dataHealth(quote, now) {
  const freshness = quoteFreshness(quote, now);
  if (freshness === "waiting") return "Waiting for first quote";
  const age = Math.max(0, Math.floor((now - quote.receivedAt) / 1_000));
  return `${freshness === "live" ? "Live" : "Stale"} · ${age}s ago`;
}

function metricRows(tokens, entries) {
  return v_flex()
    .flex_1()
    .gap(tokens.spacing.md)
    .children(
      entries.map((entry) =>
        v_flex()
          .gap(tokens.spacing.xxs)
          .child(muted(tokens, entry.title))
          .child(numeric(tokens, entry.value, 13)),
      ),
    );
}

/** @param {import("gpui").Theme} tokens @param {LongbridgeQuoteRow} quote @param {number} [now] */
export function quoteDetail(tokens, quote, now = Date.now(), pulseOpacity = 1) {
  const tone = quoteTone(tokens, quote.change);
  return v_flex()
    .id("quote-detail-content")
    .flex_1()
    .p(tokens.spacing.lg)
    .gap(tokens.spacing.lg)
    .child(
      h_flex()
        .items_center()
        .justify_between()
        .gap(tokens.spacing.lg)
        .child(
          v_flex()
            .gap(tokens.spacing.xs)
            .child(label(tokens, quote.name, 20))
            .child(muted(tokens, `${quote.market} · ${quote.symbol} · ${quote.currency}`))
            .child(muted(tokens, tradeStatusLabel(quote))),
        )
        .child(
          v_flex()
            .id("quote-detail-price")
            .items_end()
            .gap(tokens.spacing.xs)
            .opacity(quote.receivedAt ? pulseOpacity : 0.72)
            .transition("opacity", { duration: 180, easing: "ease-out" })
            .child(numeric(tokens, quote.last, 28))
            .child(
              numeric(tokens, `${quote.change} · ${quote.changePercent}`, 13).text_color(tone),
            ),
        ),
    )
    .child(rule(tokens))
    .child(
      h_flex()
        .items_start()
        .gap(tokens.spacing.xl)
        .child(
          metricRows(tokens, [
            { title: "Previous close", value: quote.prevClose },
            { title: "Open", value: quote.open },
            {
              title: "Day range",
              value:
                quote.low === "--" || quote.high === "--" ? "--" : `${quote.low} — ${quote.high}`,
            },
            { title: "Session", value: tradeStatusLabel(quote) },
          ]),
        )
        .child(
          metricRows(tokens, [
            { title: "Volume", value: formatCompactNumber(quote.volume) },
            { title: "Turnover", value: formatCompactNumber(quote.turnover) },
            { title: "Last market update", value: marketTime(quote.updatedAt) },
            { title: "Data health", value: dataHealth(quote, now) },
          ]),
        ),
    );
}

function percentage(value, total) {
  return `${total > 0 ? (value / total) * 100 : 0}%`;
}

/**
 * @param {import("gpui").Theme} tokens
 * @param {ReturnType<import("./chart.js").layoutPriceSeries>} geometry
 * @param {string} state
 * @param {Record<string, any> | null} hoveredPoint
 * @param {(event: import("gpui").MouseMoveEvent, cx: import("gpui").Context) => void} onMouseMove
 * @param {(hovered: boolean, cx: import("gpui").Context) => void} onHover
 */
export function priceChart(tokens, geometry, state, hoveredPoint, onMouseMove, onHover) {
  const height = 132;
  const chart = v_flex()
    .id("five-day-chart")
    .h(178)
    .gap(tokens.spacing.xs)
    .child(
      h_flex()
        .items_center()
        .justify_between()
        .child(label(tokens, "5D intraday"))
        .when(geometry.min !== null, (element) =>
          element.child(
            numeric(tokens, `${geometry.min.toFixed(2)} — ${geometry.max.toFixed(2)}`, 11),
          ),
        ),
    );

  if (state === "loading") {
    return chart.child(
      Progress.new("five-day-loading")
        .indeterminate(true)
        .h(height)
        .flex()
        .items_center()
        .child(
          ProgressTrack.new()
            .w_full()
            .h(2)
            .bg(tokens.muted)
            .child(ProgressIndicator.new().w("42%").h_full().bg(tokens.primary)),
        ),
    );
  }
  if (state === "error" || geometry.points.length === 0) {
    return chart.child(
      v_flex()
        .h(height)
        .items_center()
        .justify_center()
        .child(muted(tokens, state === "error" ? "Chart unavailable" : "No 5D data")),
    );
  }

  const points = geometry.points.map((point) => [
    percentage(point.x, geometry.width),
    percentage(point.y, geometry.height),
  ]);
  const fillBuilder = PathBuilder.fill().move_to(points[0][0], "100%");
  for (const point of points) fillBuilder.line_to(point[0], point[1]);
  const fill = fillBuilder.line_to(points.at(-1)[0], "100%").close().build();
  const stroke = PathBuilder.stroke(1.5).add_polygon(points, false).build();
  const area = Background.linear_gradient(
    180,
    Background.stop(tokens.primary, 0),
    Background.stop(tokens.surface, 1),
  ).opacity(0.32);
  const hoverX = hoveredPoint ? percentage(hoveredPoint.x, geometry.width) : null;
  const hoverY = hoveredPoint ? percentage(hoveredPoint.y, geometry.height) : null;
  const indicator = hoveredPoint
    ? PathBuilder.stroke(1)
        .move_to(hoverX, 0)
        .line_to(hoverX, "100%")
        .dash_array([3, 3])
        .build()
    : null;
  const marker = hoveredPoint
    ? PathBuilder.fill()
        .move_to(hoverX, `${Math.max(0, (hoveredPoint.y / geometry.height) * 100 - 3)}%`)
        .line_to(`${Math.min(100, (hoveredPoint.x / geometry.width) * 100 + 0.9)}%`, hoverY)
        .line_to(hoverX, `${Math.min(100, (hoveredPoint.y / geometry.height) * 100 + 3)}%`)
        .line_to(`${Math.max(0, (hoveredPoint.x / geometry.width) * 100 - 0.9)}%`, hoverY)
        .close()
        .build()
    : null;
  const hoverTime = hoveredPoint
    ? new Date(hoveredPoint.timestamp * 1000).toISOString().slice(11, 16)
    : "";

  return chart
    .child(
      div()
        .id("five-day-plot")
        .relative()
        .h(height)
        .w_full()
        .on_mouse_move(onMouseMove)
        .on_hover(onHover)
        .child(paint_path(fill, area).absolute().inset_0())
        .child(paint_path(stroke, tokens.primary).absolute().inset_0())
        .when(indicator, (element) =>
          element
            .child(paint_path(indicator, tokens.muted_foreground).absolute().inset_0())
            .child(paint_path(marker, tokens.primary).absolute().inset_0())
            .child(
              v_flex()
                .absolute()
                .top(4)
                .when(hoveredPoint.x > geometry.width * 0.68, (tip) => tip.left(4))
                .when(hoveredPoint.x <= geometry.width * 0.68, (tip) => tip.right(4))
                .px(tokens.spacing.sm)
                .py(tokens.spacing.xs)
                .gap(tokens.spacing.xxs)
                .rounded(tokens.radius.sm)
                .border(1)
                .border_color(tokens.border)
                .bg(tokens.surface)
                .child(numeric(tokens, hoveredPoint.close.toFixed(3), 12))
                .child(muted(tokens, `${hoveredPoint.date} ${hoverTime} UTC`)),
            ),
        ),
    )
    .child(
      h_flex()
        .justify_between()
        .children(geometry.days.map((day) => muted(tokens, day.date.slice(5)))),
    );
}

// Five categorical hues, assigned in a fixed order and never cycled — a sixth
// holding folds into "Other" rather than borrowing a hue that already means
// something else (see `foldAllocationSlices`). Each mode is stepped for its own
// surface rather than flipped from the other, and both were validated together
// for lightness band, chroma floor, colour-vision-deficient separation and
// contrast against this application's surfaces (#ffffff and #0a0a0a). Adjacent
// wedges clear the CVD gate by ΔE 9.1 light / 8.4 dark. Three of the light
// steps sit under 3:1 against white, which is why the legend beside the ring
// always carries the name, the value and the percentage: identity is never
// colour alone.
const ALLOCATION_HUES = Object.freeze({
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"],
});

/** A wedge's colour. "Other" is a remainder, not an identity, so it stays grey. */
function allocationColor(tokens, slice, index) {
  if (slice.other) return tokens.muted_foreground;
  const hues = ALLOCATION_HUES[tokens.is_dark ? "dark" : "light"];
  return hues[Math.min(index, hues.length - 1)];
}

// Trimmed from both ends of every wedge so neighbouring fills are separated by
// the surface rather than meeting flush. Skipped when one holding is the whole
// ring, which would otherwise leave a gap in a solid circle.
const WEDGE_GAP_RADIANS = 0.02;

function donutSlice(tokens, slice, index, total, count) {
  const span = total > 0 ? (slice.value / total) * Math.PI * 2 : 0;
  const gap = count > 1 ? Math.min(WEDGE_GAP_RADIANS, span / 4) : 0;
  const start = (total > 0 ? (slice.offset / total) * Math.PI * 2 : 0) - Math.PI / 2 + gap;
  const end = start + span - gap * 2;
  const steps = Math.max(4, Math.ceil(((end - start) / (Math.PI * 2)) * 48));
  const points = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = start + ((end - start) * step) / steps;
    points.push([`${50 + Math.cos(angle) * 48}%`, `${50 + Math.sin(angle) * 48}%`]);
  }
  for (let step = steps; step >= 0; step -= 1) {
    const angle = start + ((end - start) * step) / steps;
    points.push([`${50 + Math.cos(angle) * 29}%`, `${50 + Math.sin(angle) * 29}%`]);
  }
  return paint_path(
    PathBuilder.fill().add_polygon(points).build(),
    Background.solid(allocationColor(tokens, slice, index)),
  )
    .absolute()
    .inset_0();
}

/** @param {import("gpui").Theme} tokens @param {ReturnType<import("./portfolio.js").allocationInUsd>} group */
export function allocationChart(tokens, group) {
  let offset = 0;
  const slices = foldAllocationSlices(group).map((slice) => {
    const result = { ...slice, offset };
    offset += slice.value;
    return result;
  });
  const legend = Table.new(`allocation-${group.currency}`)
    .column_count(3)
    .row_count(slices.length)
    .flex_1()
    .min_w(220)
    .child(
      TableBody.new(`allocation-${group.currency}-body`).children(
        slices.map((slice, index) =>
          TableRow.new(`allocation-${group.currency}-${slice.symbol}`, index + 1)
            .flex()
            .items_center()
            .py(tokens.spacing.xs)
            .border_b(1)
            .border_color(tokens.border)
            .child(
              TableCell.new(`allocation-name-${slice.symbol}`, 1)
                .flex()
                .items_center()
                .gap(tokens.spacing.xs)
                .flex_1()
                .child(
                  div()
                    .w(7)
                    .h(7)
                    .rounded(tokens.radius.full)
                    .bg(allocationColor(tokens, slice, index)),
                )
                .child(label(tokens, slice.name)),
            )
            .child(
              TableCell.new(`allocation-value-${slice.symbol}`, 2)
                .w(90)
                .text_right()
                .child(numeric(tokens, slice.value.toFixed(2), 11)),
            )
            .child(
              TableCell.new(`allocation-percent-${slice.symbol}`, 3)
                .w(64)
                .text_right()
                .child(numeric(tokens, `${slice.percent.toFixed(1)}%`, 11)),
            ),
        ),
      ),
    );

  return v_flex()
    .gap(tokens.spacing.sm)
    .child(
      h_flex()
        .justify_between()
        .child(label(tokens, group.currency))
        .child(muted(tokens, "Allocation")),
    )
    .child(
      h_flex()
        .flex_wrap()
        .items_center()
        .gap(tokens.spacing.lg)
        .child(
          div()
            .relative()
            .w(148)
            .h(148)
            .flex_none()
            .children(
              slices.map((slice, index) =>
                donutSlice(tokens, slice, index, group.total, slices.length),
              ),
            ),
        )
        .child(legend),
    )
    .when(group.unpriced.length > 0, (element) =>
      element.child(muted(tokens, `${group.unpriced.length} unpriced position(s)`)),
    );
}

/** @param {import("gpui").Theme} tokens @param {{ title: string, value: string }[]} entries */
export function detailGrid(tokens, entries) {
  return v_flex()
    .gap(tokens.spacing.sm)
    .children(
      entries.map((entry) =>
        h_flex()
          .items_center()
          .justify_between()
          .gap(tokens.spacing.md)
          .child(muted(tokens, entry.title))
          .child(label(tokens, entry.value)),
      ),
    );
}

function pnlTone(tokens, value) {
  return value < 0 ? tokens.destructive : value > 0 ? tokens.primary : tokens.foreground;
}

/**
 * @param {import("gpui").Theme} tokens
 * @param {{ netAssets: string, totalCash: string, buyingPower: string, currency: string }} account
 * @param {{ currency: string, todayPnl: string, todayPnlValue: number, totalPnl: string, totalPnlValue: number }[]} summaries
 */
export function portfolioSummary(tokens, account, summaries) {
  const metric = (title, value, tone = tokens.foreground) =>
    v_flex()
      .flex_basis(170)
      .flex_grow(1)
      .gap(tokens.spacing.xs)
      .child(muted(tokens, title))
      .child(numeric(tokens, value, 18).text_color(tone));
  const pnl = summaries.length
    ? summaries
    : [
        {
          currency: account.currency,
          todayPnl: "--",
          totalPnl: "--",
          todayPnlValue: 0,
          totalPnlValue: 0,
        },
      ];

  return h_flex()
    .flex_wrap()
    .items_start()
    .gap(tokens.spacing.xl)
    .p(tokens.spacing.md)
    .child(metric("Net assets", `${account.netAssets} ${account.currency}`))
    .children(
      pnl.map((summary) =>
        metric(
          "Today's P/L",
          `${summary.todayPnl} ${summary.currency}`,
          pnlTone(tokens, summary.todayPnlValue),
        ),
      ),
    )
    .children(
      pnl.map((summary) =>
        metric(
          "Total P/L",
          `${summary.totalPnl} ${summary.currency}`,
          pnlTone(tokens, summary.totalPnlValue),
        ),
      ),
    )
    .child(metric("Cash", `${account.totalCash} ${account.currency}`))
    .child(metric("Buying power", `${account.buyingPower} ${account.currency}`));
}

/** @param {import("gpui").Theme} tokens */
const HOLDINGS_COLUMNS = [
  { title: "Instrument", size: (el) => el.w("26%") },
  { title: "Quantity", size: (el) => el.w("12%").justify_end() },
  { title: "Last / Cost", size: (el) => el.w("20%").justify_end() },
  { title: "Today's P/L", size: (el) => el.w("20%").justify_end() },
  { title: "Total P/L", size: (el) => el.flex_1().justify_end() },
];

export function holdingsHeader(tokens) {
  return tableHeaderRow(tokens, "holdings", HOLDINGS_COLUMNS);
}

/**
 * The height Holdings rows are drawn at. See `QUOTE_ROW_HEIGHT`.
 *
 * Tighter than a watchlist row: two lines of type and a hairline come to 39.75,
 * so this is that plus a little, and no more. A portfolio is read as a block —
 * how much of it fits at once matters more than how much air each row has.
 */
export const HOLDING_ROW_HEIGHT = 42;

/**
 * @param {import("gpui").Theme} tokens
 * @param {LongbridgeHoldingRow} holding
 * @param {number} rowIndex
 */
export function holdingRow(tokens, holding, rowIndex = 0) {
  const todayTone = pnlTone(tokens, holding.todayPnlValue);
  const totalTone = pnlTone(tokens, holding.totalPnlValue);
  const cell = (column, build) =>
    build(TableCell.new(`holding-${holding.symbol}-${column}`, column));
  return TableRow.new(`holding-${holding.symbol}`, rowIndex + 2)
    .flex()
    .items_center()
    .w_full()
    .h(HOLDING_ROW_HEIGHT)
    .gap(tokens.spacing.sm)
    .px(tokens.spacing.sm)
    .py(tokens.spacing.xs)
    .border_b(1)
    .border_color(tokens.border)
    .hover((style) => style.bg(tokens.muted))
    .child(
      cell(1, (element) =>
        element
          .flex()
          .flex_col()
          .w("26%")
          .gap(tokens.spacing.xxs)
          .child(label(tokens, holding.symbol))
          .child(muted(tokens, holding.name)),
      ),
    )
    .child(
      cell(2, (element) =>
        element.flex().w("12%").justify_end().child(numeric(tokens, holding.quantity)),
      ),
    )
    .child(
      cell(3, (element) =>
        element
          .flex()
          .flex_col()
          .w("20%")
          .items_end()
          .gap(tokens.spacing.xxs)
          .child(numeric(tokens, holding.last))
          .child(muted(tokens, holding.costPrice)),
      ),
    )
    .child(
      cell(4, (element) =>
        element
          .flex()
          .w("20%")
          .justify_end()
          .child(numeric(tokens, holding.todayPnl).text_color(todayTone)),
      ),
    )
    .child(
      cell(5, (element) =>
        element
          .flex()
          .flex_col()
          .flex_1()
          .items_end()
          .gap(tokens.spacing.xxs)
          .child(numeric(tokens, holding.totalPnl).text_color(totalTone))
          .child(numeric(tokens, holding.totalPnlPercent, 11).text_color(totalTone)),
      ),
    );
}

/**
 * The device code, as the thing the sign-in screen is actually about.
 *
 * Spaced by hand: the runtime exposes no letter-spacing, and a code that has
 * to be copied off a screen and typed into a phone is worth the character gaps
 * more than most text is.
 *
 * @param {import("gpui").Theme} tokens
 * @param {string} code
 */
export function deviceCodeBox(tokens, code) {
  return h_flex()
    .items_center()
    .justify_center()
    .w_full()
    .py(tokens.spacing.md)
    .px(tokens.spacing.sm)
    .rounded(tokens.radius.md)
    .border(1)
    .border_color(tokens.border)
    .bg(tokens.muted)
    .child(
      numeric(tokens, code.split("").join(" "), 22)
        .font_weight(600)
        .text_color(tokens.foreground),
    );
}

/**
 * A numbered step. Sign-in is a three-place errand — open a page, type a code,
 * approve — and the screen says so rather than leaving it to be inferred from
 * the order of the controls.
 *
 * @param {import("gpui").Theme} tokens
 * @param {number} index
 * @param {string} title
 */
export function step(tokens, index, title) {
  return h_flex()
    .items_center()
    .gap(tokens.spacing.sm)
    .child(
      h_flex()
        .items_center()
        .justify_center()
        .w(16)
        .h(16)
        .flex_none()
        .rounded(tokens.radius.full)
        .bg(tokens.secondary)
        .child(numeric(tokens, index, 10).text_color(tokens.secondary_foreground)),
    )
    .child(muted(tokens, title));
}

/** @param {import("gpui").Theme} tokens @param {string} title @param {string} detail */
export function emptyPanel(tokens, title, detail) {
  return v_flex()
    .items_center()
    .justify_center()
    .gap(tokens.spacing.xs)
    .py(tokens.spacing.xl)
    .px(tokens.spacing.md)
    .child(label(tokens, title))
    .child(muted(tokens, detail));
}

/** @param {import("gpui").Theme} tokens @param {string} value */
export function errorMessage(tokens, value) {
  return h_flex()
    .w_full()
    .gap(tokens.spacing.sm)
    .p(tokens.spacing.sm)
    .rounded(tokens.radius.sm)
    .border(1)
    .border_color(tokens.destructive)
    .bg(tokens.surface)
    .child(div().w(3).self_stretch().rounded(tokens.radius.full).bg(tokens.destructive))
    .child(
      text(value)
        .flex_1()
        .min_w(0)
        .whitespace_normal()
        .text_size(12)
        .line_height(1.35)
        .text_color(tokens.foreground),
    );
}
