// Compact presentation primitives for the read-only terminal. Every visual
// decision resolves from the call-scoped semantic theme.

import { Background, PathBuilder, div, svg } from "gpui";
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
  Avatar,
  AvatarFallback,
  Button,
  Input,
  Link,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  h_flex,
  v_flex,
} from "gpui-base";
import {
  amplitude,
  averagePrice,
  changeFromOpen,
  formatCompactNumber,
  quoteFreshness,
  tradeStatusLabel,
} from "./market.js";
import { formatMarketDate, formatMarketTime } from "./chart.js";
import { validDepthLevel } from "./market_detail.js";
import { tradeIdentity, tradeVolumeRatio } from "./market_detail.js";
import { allocationColor, avatarColor, changeTone, statusColors, valueTone } from "./palette.js";
import { allocationSliceAt, foldAllocationSlices } from "./portfolio.js";

/**
 * The one transition this interface uses. A terminal answers immediately; the
 * only thing worth easing is a value fading in over the one it replaced, and
 * it is worth easing at one speed everywhere rather than three.
 */
const MOTION = Object.freeze({ duration: 150, easing: "ease-out" });

/** @param {import("gpui-base").Theme} tokens @param {string | number} value @param {number} [size] */
export const label = (tokens, value, size = 12) =>
  div().text_size(size).line_height(1.25).text_color(tokens.foreground).child(value);

/**
 * A figure rather than prose: a price, a quantity, a percentage, a duration.
 *
 * It states no family of its own. The whole window is monospaced from the root
 * container down and every text style in GPUI cascades, so a family written
 * here would not add a mono face — it would *replace* the one the application
 * registered with whatever this string happened to resolve to, and these
 * elements would be the only text in the window drawn in a different face.
 *
 * What survives is the name at the call site. `numeric` marks a value as a
 * figure wherever one is drawn, which is what a later change to how figures
 * are set — tabular digits, alignment, a colour floor — would need to find.
 *
 * @param {import("gpui-base").Theme} tokens @param {string | number} value @param {number} [size]
 */
export const numeric = (tokens, value, size = 12) => label(tokens, value, size);

/** @param {import("gpui-base").Theme} tokens @param {string | number} value */
export const muted = (tokens, value) =>
  div().text_size(11).line_height(1.25).text_color(tokens.muted_foreground).child(value);

/**
 * A section heading or a column head: small, bold, muted and upper case, the
 * way a terminal writes small-caps. Only the visible text is folded — every
 * lookup keyed by a heading's title still takes the title as it was written.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {string} value
 */
export const smallCaps = (tokens, value) =>
  muted(tokens, String(value).toUpperCase()).font_weight(700);

/**
 * The box every icon control in this file is drawn in, so that a toggle, a
 * menu trigger and a dock's collapse control are one family rather than three
 * sizes. The border is always drawn and only ever changes colour: a control
 * that grows a border on hover moves its neighbours.
 *
 * Two sizes: 24 for a control that stands on its own in window chrome, and 20
 * for one sitting inside a panel's own title row, where a 24 crowds the
 * heading beside it.
 *
 * @param {import("gpui-base").Theme} tokens
 * @template {import("gpui").Element} E
 * @param {E} element
 * @param {number} [size]
 */
const iconBox = (tokens, element, size = 24) =>
  element
    .flex()
    .items_center()
    .justify_center()
    .w(size)
    .h(size)
    .flex_none()
    .rounded(tokens.radius.sm)
    .border(1);

/** @param {string} asset @param {number} [size] */
const icon = (asset, size = 12) => svg(asset).w(size).h(size).flex_none();

/** @param {import("gpui-base").Theme} tokens */
export const rule = (tokens) => div().w_full().h(1).bg(tokens.border);

/** @param {import("gpui-base").Theme} tokens */
export const panel = (tokens) =>
  v_flex()
    .bg(tokens.surface)
    .border(1)
    .border_color(tokens.border)
    .rounded(tokens.radius.md)
    .overflow_hidden();

/**
 * @param {import("gpui-base").Theme} tokens
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
  // Every variant draws a border; the quiet one draws it in its own fill. A
  // button that gains a border on hover is a button that resizes on hover, and
  // its neighbours move with it.
  const border = ghost
    ? background
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
    .border(1)
    .border_color(border)
    .bg(background)
    .text_size(11)
    .text_color(foreground)
    .transition("opacity", MOTION)
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
    .child(caption);
}

/**
 * @param {import("gpui-base").Theme} tokens
 * @param {(event: import("gpui").ClickEvent, cx: import("gpui").Context) => void} onClick
 */
/**
 * A quiet icon control: `action`'s ghost variant, one step smaller, with the
 * caption moved into the tooltip and the accessibility label.
 *
 * Where a panel's title row carries its own controls there is room for the
 * mark and not for the word: two 28px captioned buttons beside a heading read
 * as the point of the panel rather than as the way out of it. The border is
 * drawn in the panel's own fill so that lighting it on hover moves nothing.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {string} id
 * @param {string} hint What the control does, for the tooltip and the label.
 * @param {string} asset
 * @param {(event: import("gpui").ClickEvent, cx: import("gpui").Context) => void} onClick
 */
export function iconAction(tokens, id, hint, asset, onClick) {
  return iconBox(tokens, Button.new(id), 20)
    .accessibility_label(hint)
    .tooltip(hint)
    .on_click(onClick)
    .border_color(tokens.surface)
    .bg(tokens.surface)
    .text_color(tokens.muted_foreground)
    .transition("opacity", MOTION)
    .hover((style) => style.bg(tokens.accent).text_color(tokens.accent_foreground))
    .focus((style) => style.bg(tokens.accent).text_color(tokens.accent_foreground))
    .child(icon(asset, 11));
}

export function themeButton(tokens, onClick) {
  const dark = tokens.appearance === "dark";
  const hint = dark ? "Switch to light theme" : "Switch to dark theme";
  return iconBox(tokens, Button.new("theme-toggle"))
    .accessibility_label(hint)
    .tooltip(hint)
    .on_click(onClick)
    .border_color(tokens.surface)
    .bg(tokens.surface)
    .text_color(tokens.muted_foreground)
    .transition("opacity", MOTION)
    .hover((style) => style.bg(tokens.accent).text_color(tokens.accent_foreground))
    .focus((style) => style.bg(tokens.accent).text_color(tokens.accent_foreground))
    .child(icon(dark ? "assets/sun.svg" : "assets/moon.svg"));
}

/**
 * The control that folds the stock details away, and brings them back.
 *
 * It lives in the window's chrome rather than in the pane it hides, which is
 * not a placement preference: a control inside the detail pane would go with
 * the pane, and a toggle you cannot reach once you have used it is a one-way
 * door.
 *
 * The state is read from the dock rather than kept beside it -- the user can
 * also collapse the pane by dragging its edge shut, and a mirrored boolean
 * would start lying the first time they did. Both icons show a pane, present
 * or gone, so the state is legible without relying on the fill alone.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {boolean} open
 * @param {(event: import("gpui").ClickEvent, cx: import("gpui").Context) => void} onClick
 */
/** @param {import("gpui-base").Theme} tokens @param {string} id @param {string} caption @param {string} url */
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
    .child(caption);
}

/** @param {import("gpui-base").Theme} tokens @param {string} value */
export function connectionPill(tokens, value) {
  const active = value === "connected";
  const waiting =
    value === "authorizing" ||
    value === "connecting" ||
    value === "authenticating" ||
    value === "subscribing" ||
    value === "snapshotting" ||
    value === "reconnecting";
  // A feed's health is a reading, not an interface state: green, yellow and
  // red come from the status row so the one interactive accent keeps meaning
  // "you can press this". The colour is never the whole signal — the word
  // beside it says the same thing.
  const status = statusColors(tokens);
  const color = active
    ? status.up
    : waiting
      ? status.warning
      : value === "error"
        ? status.down
        : tokens.muted_foreground;
  return h_flex()
    .id("connection-state")
    .items_center()
    .gap(tokens.spacing.xs)
    .tooltip(`Quote stream: ${value}`)
    .opacity(waiting ? 0.72 : 1)
    .transition("opacity", MOTION)
    .child(div().w(6).h(6).rounded(tokens.radius.none).bg(color))
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
//
// Keyed by the title as it is written, not as it is drawn: a header is folded
// to upper case on its way to the screen, and a lookup that followed it there
// would have to be re-keyed every time a column is renamed.
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
  Side: "Buy or sell, over the order type",
  Status: "Where the order stands, over whatever the broker said about it",
  Filled: "Shares executed, of the quantity ordered",
  Price: "Price ordered, over the price it executed at",
  Submitted: "When the order was placed, in the market's own time",
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
 * @param {import("gpui-base").Theme} tokens
 * @param {string} id
 * @param {{ title: string, size: (el: import("gpui").Element) => import("gpui").Element }[]} columns
 */
function tableHeaderRow(tokens, id, columns) {
  return TableHeader.new(`${id}-header`).child(
    // Row one of the table's rows: the body rows below start at two, the way
    // an accessible row index counts every row including this one.
    TableRow.new(`${id}-header-row`, 1)
      .flex()
      .items_center()
      .h(TABLE_HEADER_HEIGHT)
      .gap(tokens.spacing.sm)
      .px(tokens.spacing.sm)
      .bg(tokens.background)
      .border_b(1)
      .border_color(tokens.border)
      .children(
        columns.map((column, index) =>
          column.size(
            TableHead.new(`${id}-head-${index + 1}`, index + 1)
              .flex()
              .items_center()
              // TableHead keeps the column's table semantics, while its
              // full-size div is the shell-owned tooltip trigger.
              .child(
                (column.align ?? ((element) => element))(
                  div()
                    .size_full()
                    .flex()
                    .items_center()
                    .tooltip(COLUMN_HINTS[column.title] ?? column.title)
                    .child(smallCaps(tokens, column.title)),
                ),
              ),
          ),
        ),
      ),
  );
}

const WATCHLIST_COLUMNS = [
  { title: "Instrument", size: (el) => el.w("31%") },
  { title: "Last", size: (el) => el.w("19%"), align: (el) => el.justify_end() },
  { title: "Change", size: (el) => el.w("18%"), align: (el) => el.justify_end() },
  { title: "Volume", size: (el) => el.w("16%"), align: (el) => el.justify_end() },
  { title: "Session", size: (el) => el.flex_1(), align: (el) => el.justify_end() },
];

/** @param {import("gpui-base").Theme} tokens @param {boolean} [compact] */
export function watchlistHeader(tokens, compact = false) {
  // A narrow dock has room for the object and its current value. The movement,
  // volume and session lanes are secondary readings; keeping them would force
  // every number into the same few pixels and make the primary data overlap.
  return tableHeaderRow(
    tokens,
    "watchlist",
    compact
      ? [
          { title: "Instrument", size: (el) => el.w("60%") },
          { title: "Last", size: (el) => el.flex_1(), align: (el) => el.justify_end() },
        ]
      : WATCHLIST_COLUMNS,
  );
}

/**
 * One row of a popup menu.
 *
 * gpui-shell binds no menu component of its own: `Popover` is the anchored
 * surface, and what goes inside it belongs to the application. So a menu is a
 * `Button` per row carrying the menu-item role — which is what makes it a menu
 * to a screen reader and not only to a reader of this file.
 *
 * @param {import("gpui-base").Theme} tokens
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
 * @param {import("gpui-base").Theme} tokens
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
 * @param {import("gpui-base").Theme} tokens
 * @param {import("gpui-base").InputState} state
 * @param {number} [width]
 */
export function filterInput(tokens, state, width = 180) {
  return (
    Input.new(state)
      .w(width)
      // The height of every other control a title row carries -- the interval
      // tabs, the icon buttons -- because that row is 30px and a 26px field in it
      // sat on both its edges at once.
      .h(22)
      .px(tokens.spacing.xs)
      .rounded(tokens.radius.sm)
      .border(1)
      .border_color(tokens.border)
      .bg(tokens.surface)
      .text_size(11)
      .text_color(tokens.foreground)
      .focus((style) => style.border_color(tokens.ring))
  );
}

/**
 * Controls attached to a table use the same inline inset as its header and
 * rows, so the filter, first heading and first cell share one content edge.
 *
 * @param {import("gpui-base").Theme} tokens
 */
export function tableToolbar(tokens) {
  return h_flex().items_center().justify_between().px(tokens.spacing.sm).py(tokens.spacing.sm);
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
 * @param {import("gpui-base").Theme} tokens
 * @param {string} id
 * @param {string} hint
 * @param {boolean} [open]
 */
export function menuTrigger(tokens, id, hint, open = false) {
  return iconBox(tokens, Button.new(id))
    .accessibility_label(hint)
    .tooltip(hint)
    .selected(open)
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
 * Shared interactive states for rows that can be pointed at or pressed.
 * Selection is optional because Holdings has no persistent row selection,
 * while Watchlist uses the selected row to drive Stock Details.
 *
 * @param {import("gpui-base").Theme} tokens
 * @template {import("gpui").Element} E
 * @param {E} row
 * @param {boolean} [selected]
 */
function interactiveTableRow(tokens, row, selected = false) {
  return row
    .bg(selected ? tokens.accent : tokens.surface)
    .text_color(selected ? tokens.accent_foreground : tokens.foreground)
    .hover((style) => style.bg(tokens.accent).text_color(tokens.accent_foreground))
    .active((style) => style.bg(tokens.accent).text_color(tokens.accent_foreground));
}

/**
 * A watchlist row, as a table row rather than a button that looks like one.
 *
 * It registers no click handler of its own: rows are rebuilt every frame the
 * virtual list is scrolled, and a per-row callback would accumulate one
 * unreachable function per row per frame. The list carries a single
 * `on_item_click` instead and reports the instrument's stable key.
 *
 * `rowIndex` is the row's zero-based position in the whole collection; what is
 * announced is that plus two, because the header above it is row one. Selection
 * is reported separately as the virtual list's stable instrument key, not this
 * transient layout index.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {LongbridgeQuoteRow} quote
 * @param {boolean} selected
 * @param {number} rowIndex
 * @param {number} [now]
 */
export function quoteRow(tokens, quote, selected, rowIndex = 0, now = Date.now(), compact = false) {
  const tone = changeTone(tokens, quote.change);
  const cell = (column, build) => build(TableCell.new(`quote-${quote.symbol}-${column}`, column));
  return interactiveTableRow(
    tokens,
    TableRow.new(`quote-${quote.symbol}`, rowIndex + 2)
      .flex()
      .items_center()
      .w_full()
      .h(QUOTE_ROW_HEIGHT)
      .gap(tokens.spacing.sm)
      .px(tokens.spacing.sm)
      .py(tokens.spacing.xs)
      .border_b(1)
      .border_color(tokens.border),
    selected,
  )
    .opacity(quote.receivedAt ? 1 : 0.68)
    .transition("opacity", MOTION)
    .child(
      cell(1, (element) =>
        element
          .flex()
          .items_center()
          .w(compact ? "60%" : "31%")
          .gap(tokens.spacing.sm)
          // The badge is an `Avatar` with only its fallback filled: there is no
          // per-market artwork in the application directory, and an image that
          // never resolves is the case the fallback exists for.
          .when(!compact, (cell) => cell.child(marketAvatar(tokens, quote.code || quote.symbol)))
          .child(
            compact
              ? v_flex()
                  .min_w(0)
                  .gap(tokens.spacing.xxs)
                  .child(label(tokens, quote.symbol).truncate())
                  .child(muted(tokens, quote.name).truncate())
              : v_flex()
                  .min_w(0)
                  .gap(tokens.spacing.xxs)
                  .child(label(tokens, quote.code).truncate())
                  .child(muted(tokens, quote.name).truncate()),
          ),
      ),
    )
    .child(
      cell(2, (element) =>
        element
          .flex()
          .w(compact ? "40%" : "19%")
          .min_w(0)
          .justify_end()
          .child(
            compact
              ? v_flex()
                  .min_w(0)
                  .items_end()
                  .gap(tokens.spacing.xxs)
                  .child(numeric(tokens, quote.last).truncate())
                  .child(numeric(tokens, quote.changePercent).truncate().text_color(tone))
              : numeric(tokens, quote.last).truncate(),
          ),
      ),
    )
    .when(!compact, (element) =>
      element.child(
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
      ),
    )
    .when(!compact, (element) =>
      element.child(
        cell(4, (element) =>
          element
            .flex()
            .w("16%")
            .justify_end()
            .child(muted(tokens, formatCompactNumber(quote.volume))),
        ),
      ),
    )
    .when(!compact, (element) =>
      element.child(
        cell(5, (element) =>
          element
            .flex()
            .flex_1()
            .justify_end()
            .child(muted(tokens, tradeStatusLabel(quote))),
        ),
      ),
    );
}

function detailStatus(tokens, state, empty) {
  if (state?.status === "loading") return muted(tokens, "Loading live market data…");
  if (state?.status === "error")
    return muted(tokens, state.error || "Live market data is unavailable. Reconnect to try again.");
  return muted(tokens, empty);
}

function detailNumber(value) {
  return value === undefined || value === null ? "—" : formatCompactNumber(value);
}

function tradeDirection(tokens, direction) {
  if (direction === 2) return { text: "↑ Up", tone: statusColors(tokens).up };
  if (direction === 1) return { text: "↓ Down", tone: statusColors(tokens).down };
  return { text: "• Neutral", tone: tokens.muted_foreground };
}

function depthRow(tokens, side, level) {
  const levelId = level.position ?? level.price;
  return h_flex()
    .id(`order-book-${side}-level-${levelId}`)
    .items_center()
    .min_w(0)
    .h(22)
    .px(tokens.spacing.sm)
    .child(
      muted(tokens, `${side === "ask" ? "Ask" : "Bid"} ${level.position ?? ""}`)
        .w("28%")
        .min_w(0)
        .truncate(),
    )
    .child(
      numeric(tokens, level.price ?? "—")
        .w("36%")
        .min_w(0)
        .truncate()
        .text_right(),
    )
    .child(numeric(tokens, detailNumber(level.volume)).w("36%").min_w(0).truncate().text_right());
}

function orderBookStatus(state, hasDepth) {
  if (state?.status === "loading") return "Loading";
  if (state?.status === "error") return "Error";
  if (state?.status !== "ready" || !hasDepth) return "Empty";
  return "Live";
}

/**
 * The selected instrument's five-by-five depth book. The server sends nearest
 * levels first; asks are reversed so the best ask sits at the spread and bids
 * remain nearest-first below it. Missing levels are not synthetic rows.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {LongbridgeDepthState} state
 * @param {{ bid: number, ask: number }} ratio
 */
export function orderBookPanel(tokens, state, ratio) {
  const asks = Array.isArray(state?.asks)
    ? state.asks.filter(validDepthLevel).slice(0, 5).reverse()
    : [];
  const bids = Array.isArray(state?.bids) ? state.bids.filter(validDepthLevel).slice(0, 5) : [];
  const hasDepth = asks.length > 0 || bids.length > 0;
  const bidPercent = Math.round((ratio?.bid ?? 0) * 100);
  const askPercent = Math.max(0, 100 - bidPercent);
  const status = orderBookStatus(state, hasDepth);
  return v_flex()
    .id("order-book-panel")
    .w_full()
    .min_w(0)
    .child(
      h_flex()
        .items_center()
        .justify_between()
        .px(tokens.spacing.sm)
        .py(tokens.spacing.xs)
        .child(label(tokens, "Order Book", 12).font_weight(700))
        .child(muted(tokens, status)),
    )
    .child(rule(tokens))
    .child(
      state?.status !== "ready"
        ? v_flex()
            .p(tokens.spacing.md)
            .child(detailStatus(tokens, state, "No order book data"))
        : hasDepth
          ? v_flex()
              .py(tokens.spacing.xs)
              .children(asks.map((level) => depthRow(tokens, "ask", level)))
              .child(
                h_flex()
                  .id("order-book-ratio-divider")
                  .items_center()
                  .h(22)
                  .px(tokens.spacing.sm)
                  .child(muted(tokens, `Bid ${bidPercent}%`).w("28%").min_w(0).truncate())
                  .child(
                    h_flex()
                      .flex_1()
                      .h(5)
                      .overflow_hidden()
                      .bg(tokens.muted)
                      .child(div().h_full().w(`${bidPercent}%`).bg(statusColors(tokens).up))
                      .child(div().h_full().w(`${askPercent}%`).bg(statusColors(tokens).down)),
                  )
                  .child(
                    muted(tokens, `Ask ${askPercent}%`).w("28%").min_w(0).truncate().text_right(),
                  ),
              )
              .children(bids.map((level) => depthRow(tokens, "bid", level)))
          : div().h(0),
    );
}

function tradeTime({ symbol, market }, timestamp) {
  const marketSymbol = symbol || (market ? `market.${market}` : "");
  return formatMarketTime(marketSymbol, timestamp, true) || "--";
}

function tradeRow(tokens, trade, maximum, context) {
  const direction = tradeDirection(tokens, trade.direction);
  const ratio = Math.round(tradeVolumeRatio(trade.volume, maximum) * 100);
  const identity = tradeIdentity(trade);
  return h_flex()
    .id(`time-sales-row-${identity}`)
    .relative()
    .items_center()
    .min_w(0)
    .h(24)
    .gap(tokens.spacing.sm)
    .px(tokens.spacing.sm)
    .child(muted(tokens, tradeTime(context, trade.timestamp)).w("24%").min_w(0).truncate())
    .child(muted(tokens, direction.text).w("25%").min_w(0).truncate().text_color(direction.tone))
    .child(
      numeric(tokens, trade.price ?? "—")
        .flex_1()
        .min_w(0)
        .truncate()
        .text_right(),
    )
    .child(
      div()
        .relative()
        .w("28%")
        .min_w(0)
        .h_full()
        .overflow_hidden()
        .child(
          div()
            .absolute()
            .right(0)
            .top(3)
            .bottom(3)
            .w(`${ratio}%`)
            .bg(direction.tone)
            .opacity(volumeIntensity(ratio)),
        )
        .child(
          numeric(tokens, detailNumber(trade.volume))
            .relative()
            .size_full()
            .flex()
            .items_center()
            .justify_end()
            .truncate(),
        ),
    );
}

function volumeIntensity(ratio) {
  return Math.max(0.35, Math.min(1, 0.35 + (Math.max(0, ratio) / 100) * 0.65));
}

/** @param {import("gpui-base").Theme} tokens @param {LongbridgeTradesState} state @param {{ symbol?: string, market?: string }} [context] */
export function timeSalesPanel(tokens, state, context = {}) {
  const trades = Array.isArray(state?.trades) ? state.trades.slice(0, 20) : [];
  const maximum = trades.reduce((largest, trade) => {
    const volume =
      typeof trade?.volume === "bigint"
        ? trade.volume < 0n
          ? -trade.volume
          : trade.volume
        : Math.abs(Number(trade?.volume) || 0);
    return typeof largest === "bigint" || typeof volume === "bigint"
      ? BigInt(largest) > BigInt(volume)
        ? largest
        : volume
      : Math.max(largest, volume);
  }, 0);
  const status =
    state?.status === "loading"
      ? "Loading"
      : state?.status === "error"
        ? "Error"
        : state?.status !== "ready" || !trades.length
          ? "Empty"
          : `${trades.length} ${trades.length === 1 ? "trade" : "trades"}`;
  return v_flex()
    .id("time-sales-panel")
    .w_full()
    .min_w(0)
    .child(
      h_flex()
        .items_center()
        .justify_between()
        .px(tokens.spacing.sm)
        .py(tokens.spacing.xs)
        .child(label(tokens, "Time & Sales", 12).font_weight(700))
        .child(muted(tokens, status)),
    )
    .child(rule(tokens))
    .child(
      state?.status !== "ready"
        ? v_flex()
            .p(tokens.spacing.md)
            .child(detailStatus(tokens, state, "No recent trades"))
        : trades.length
          ? v_flex()
              .py(tokens.spacing.xs)
              .children(trades.map((trade) => tradeRow(tokens, trade, maximum, context)))
          : v_flex()
              .p(tokens.spacing.md)
              .child(detailStatus(tokens, state, "No recent trades")),
    );
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
    .gap(tokens.spacing.sm)
    .children(
      entries.map((entry) =>
        v_flex()
          .gap(tokens.spacing.xxs)
          // A field label, not a heading: §7.10 puts these in muted foreground
          // beside their value and leaves small-caps to the section above them.
          .child(muted(tokens, entry.title))
          .child(numeric(tokens, entry.value, 13)),
      ),
    );
}

/**
 * One reading: a muted field label above its figure.
 *
 * The basis is what makes the block responsive without a media query. At the
 * 320px the detail pane is allowed to shrink to, two of these fit a row; a
 * wider pane fits three or four, and the row rewraps rather than squeezing
 * every figure into the same few pixels.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {{ title: string, value: string, tone?: string }} entry
 */
function statCell(tokens, entry) {
  const figure = numeric(tokens, entry.value, 13).truncate();
  return v_flex()
    .min_w(0)
    .flex_basis(104)
    .flex_grow(1)
    .gap(tokens.spacing.xxs)
    .child(muted(tokens, entry.title).truncate())
    .child(entry.tone ? figure.text_color(entry.tone) : figure);
}

/**
 * The selected instrument, as one column: who it is and what it costs, then
 * the readings that change during a session, then everything else behind a
 * disclosure.
 *
 * The identity and the price share the first row rather than stacking in a
 * cell of their own. They are the two halves of one sentence — this security,
 * this price — and the widest thing on screen is the price, so it is set
 * against the pane's right edge where a column of figures would be. What
 * follows is a wrapping grid: the same readings whatever the pane's width,
 * arranged by how much width there is.
 *
 * The disclosure is the pane's own state, passed in, because a section that
 * remembered whether it was open would forget every time the quote ticked.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {LongbridgeQuoteRow} quote
 * @param {number} [now]
 * @param {number} [pulseOpacity]
 * @param {{ open?: boolean, onToggle?: (open: boolean, cx: import("gpui").Context) => void }} [disclosure]
 */
export function quoteDetail(tokens, quote, now = Date.now(), pulseOpacity = 1, disclosure = {}) {
  const tone = changeTone(tokens, quote.change);
  const { open = false, onToggle = () => {} } = disclosure ?? {};
  const dayRange =
    quote.low === "--" || quote.high === "--" ? "--" : `${quote.low} — ${quote.high}`;
  return v_flex()
    .id("quote-detail-content")
    .w_full()
    .min_w(0)
    .child(
      h_flex()
        .id("quote-detail-heading")
        .items_start()
        .justify_between()
        .gap(tokens.spacing.md)
        .px(tokens.spacing.sm)
        .pt(tokens.spacing.sm)
        .pb(tokens.spacing.xs)
        .child(
          v_flex()
            .flex_1()
            .min_w(0)
            .gap(tokens.spacing.xxs)
            .child(label(tokens, quote.name, 15).font_weight(700).truncate())
            .child(
              muted(tokens, `${quote.market} · ${quote.symbol} · ${quote.currency}`).truncate(),
            ),
        )
        .child(
          v_flex()
            .id("quote-detail-price")
            .flex_none()
            .items_end()
            .gap(tokens.spacing.xxs)
            .opacity(quote.receivedAt ? pulseOpacity : 0.72)
            .transition("opacity", MOTION)
            .child(numeric(tokens, quote.last, 22))
            .child(
              numeric(tokens, `${quote.change} · ${quote.changePercent}`, 12).text_color(tone),
            ),
        ),
    )
    .child(rule(tokens))
    .child(
      h_flex()
        .id("quote-detail-stats")
        .flex_wrap()
        .items_start()
        .px(tokens.spacing.sm)
        .py(tokens.spacing.sm)
        .gap_x(tokens.spacing.md)
        .gap_y(tokens.spacing.sm)
        .children(
          [
            { title: "Previous close", value: quote.prevClose },
            { title: "Open", value: quote.open },
            { title: "High", value: quote.high },
            { title: "Low", value: quote.low },
            { title: "Volume", value: formatCompactNumber(quote.volume) },
            { title: "Turnover", value: formatCompactNumber(quote.turnover) },
          ].map((entry) => statCell(tokens, entry)),
        ),
    )
    .child(rule(tokens))
    .child(
      accordionGroup("quote-detail-sections").child(
        accordionSection(tokens, {
          id: "quote-detail-more",
          title: "More detail",
          detail: tradeStatusLabel(quote, now),
          level: 3,
          open,
          inset: tokens.spacing.sm,
          onToggle,
          body: h_flex()
            .id("quote-detail-more-stats")
            .flex_wrap()
            .items_start()
            .px(tokens.spacing.sm)
            .py(tokens.spacing.sm)
            .gap_x(tokens.spacing.md)
            .gap_y(tokens.spacing.sm)
            .children(
              [
                { title: "Day range", value: dayRange },
                { title: "Amplitude", value: amplitude(quote) },
                { title: "Average price", value: averagePrice(quote) },
                {
                  title: "From open",
                  value: changeFromOpen(quote),
                  tone: changeTone(tokens, changeFromOpen(quote)),
                },
                { title: "Last market update", value: marketTime(quote.updatedAt) },
                { title: "Data health", value: dataHealth(quote, now) },
                { title: "Stream sequence", value: String(quote.sequence ?? "--") },
              ].map((entry) => statCell(tokens, entry)),
            ),
        }),
      ),
    );
}

// The ring's categorical hues live in `palette.js` with the status row: they
// are the other thing the semantic token set cannot carry, and one module owns
// every colour this application draws that is not a token.

// Trimmed from both ends of every wedge so neighbouring fills are separated by
// the surface rather than meeting flush. Skipped when one holding is the whole
// ring, which would otherwise leave a gap in a solid circle.
const WEDGE_GAP_RADIANS = 0.02;

/** The ring's drawn size. `allocationSliceAt` measures the pointer against it. */
const RING_SIZE = 148;

/**
 * One wedge.
 *
 * `state` is what the pointer is doing to the ring: `"lit"` for the wedge
 * being pointed at, `"dimmed"` for the others while one is, and `"resting"`
 * when nothing is. A lit wedge reaches further out than the ring and keeps its
 * full colour; the rest fade back, which is what makes the one being read
 * legible without redrawing the legend beside it.
 *
 * The reach is a geometry change and lands at once; the fade is an opacity
 * change and is what actually animates. Interpolating the path itself is not
 * something this runtime can do, and a wedge that grew over 150ms while its
 * neighbours faded over the same 150ms would be two animations to watch.
 */
function donutSlice(tokens, slice, index, total, count, state = "resting") {
  const span = total > 0 ? (slice.value / total) * Math.PI * 2 : 0;
  const gap = count > 1 ? Math.min(WEDGE_GAP_RADIANS, span / 4) : 0;
  const start = (total > 0 ? (slice.offset / total) * Math.PI * 2 : 0) - Math.PI / 2 + gap;
  const end = start + span - gap * 2;
  const steps = Math.max(4, Math.ceil(((end - start) / (Math.PI * 2)) * 48));
  const outer = state === "lit" ? 50 : 48;
  const points = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = start + ((end - start) * step) / steps;
    points.push([`${50 + Math.cos(angle) * outer}%`, `${50 + Math.sin(angle) * outer}%`]);
  }
  for (let step = steps; step >= 0; step -= 1) {
    const angle = start + ((end - start) * step) / steps;
    points.push([`${50 + Math.cos(angle) * 29}%`, `${50 + Math.sin(angle) * 29}%`]);
  }
  return window
    .paint_path(
      PathBuilder.fill().add_polygon(points).build(),
      Background.solid(allocationColor(tokens, slice, index)),
    )
    .absolute()
    .inset_0()
    .opacity(state === "dimmed" ? 0.4 : 1)
    .transition("opacity", MOTION);
}

/**
 * The ring, and the legend that says what its colours mean.
 *
 * A wedge cannot be pointed at directly -- every wedge is painted into the
 * same square, so the box a pointer is over is the whole ring -- so the legend
 * row is the handle: pointing at a row lights its wedge, and the ring answers
 * the question the row asks.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {ReturnType<import("./portfolio.js").allocationInUsd>} group
 * @param {{ hovered?: string | null, onHover?: (symbol: string | null, cx: import("gpui").Context) => void }} [pointer]
 */
export function allocationChart(tokens, group, pointer = {}) {
  const { hovered = null, onHover = null } = pointer;
  const unpriced = group.unpriced.length;
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
            .relative()
            .flex()
            .items_center()
            .py(tokens.spacing.xs)
            .px(tokens.spacing.xs)
            .rounded(tokens.radius.sm)
            .border_b(1)
            .border_color(tokens.border)
            .bg(hovered === slice.symbol ? tokens.accent : tokens.surface)
            .transition("opacity", MOTION)
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
                    .rounded(tokens.radius.none)
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
            )
            // The handler is on a plain element covering the row, not on the
            // row: a table part carries its click and its hover *styles*, and
            // an `on_hover` written on one is dropped on the way through. The
            // sheet is transparent and takes nothing away from the cells under
            // it, which answer to nothing.
            .when(Boolean(onHover), (row) =>
              row.child(
                div()
                  .id(`allocation-hover-${group.currency}-${slice.symbol}`)
                  .absolute()
                  .inset_0()
                  .on_hover((over, cx) => onHover(over ? slice.symbol : null, cx)),
              ),
            ),
        ),
      ),
    );

  return v_flex()
    .gap(tokens.spacing.sm)
    .child(
      h_flex()
        .justify_between()
        .child(label(tokens, group.currency).font_weight(700))
        .child(smallCaps(tokens, "Allocation")),
    )
    .child(
      h_flex()
        .flex_wrap()
        .items_center()
        .gap(tokens.spacing.lg)
        .child(
          div()
            .id(`allocation-ring-${group.currency}`)
            .relative()
            .w(RING_SIZE)
            .h(RING_SIZE)
            .flex_none()
            .when(Boolean(onHover), (ring) =>
              ring
                // A wedge cannot carry the handler -- every wedge is painted
                // into this same box, so all of them would report themselves
                // at once. The box carries it, and `allocationSliceAt` says
                // which wedge the pointer is actually over.
                .on_mouse_move((event, cx) =>
                  onHover(
                    allocationSliceAt(slices, group.total, event.local_position, {
                      width: RING_SIZE,
                      height: RING_SIZE,
                    }),
                    cx,
                  ),
                )
                .on_hover((over, cx) => {
                  if (!over) onHover(null, cx);
                }),
            )
            .children(
              slices.map((slice, index) =>
                donutSlice(
                  tokens,
                  slice,
                  index,
                  group.total,
                  slices.length,
                  hovered === null ? "resting" : hovered === slice.symbol ? "lit" : "dimmed",
                ),
              ),
            ),
        )
        .child(legend),
    )
    .when(unpriced > 0, (element) =>
      element.child(muted(tokens, `${unpriced} unpriced position${unpriced === 1 ? "" : "s"}`)),
    );
}

/** @param {import("gpui-base").Theme} tokens @param {{ title: string, value: string }[]} entries */
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

/**
 * @param {import("gpui-base").Theme} tokens
 * @param {{ netAssets: string, totalCash: string, buyingPower: string, currency: string }} account
 * @param {{ currency: string, todayPnl: string, todayPnlValue: number, totalPnl: string, totalPnlValue: number }[]} summaries
 */
export function portfolioSummary(tokens, account, summaries) {
  const metric = (title, value, tone = tokens.foreground) =>
    v_flex()
      .flex_basis(170)
      .flex_grow(1)
      .gap(tokens.spacing.xs)
      // A field label beside its value, so muted rather than small-caps — the
      // heading above this row is the section, these are its readings.
      .child(muted(tokens, title))
      .child(numeric(tokens, value, 16).text_color(tone));
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
          valueTone(tokens, summary.todayPnlValue),
        ),
      ),
    )
    .children(
      pnl.map((summary) =>
        metric(
          "Total P/L",
          `${summary.totalPnl} ${summary.currency}`,
          valueTone(tokens, summary.totalPnlValue),
        ),
      ),
    )
    .child(metric("Cash", `${account.totalCash} ${account.currency}`))
    .child(metric("Buying power", `${account.buyingPower} ${account.currency}`));
}

/** @param {import("gpui-base").Theme} tokens */
const HOLDINGS_COLUMNS = [
  { title: "Instrument", size: (el) => el.w("26%") },
  { title: "Quantity", size: (el) => el.w("12%"), align: (el) => el.justify_end() },
  { title: "Last / Cost", size: (el) => el.w("20%"), align: (el) => el.justify_end() },
  { title: "Today's P/L", size: (el) => el.w("20%"), align: (el) => el.justify_end() },
  { title: "Total P/L", size: (el) => el.flex_1(), align: (el) => el.justify_end() },
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
 * @param {import("gpui-base").Theme} tokens
 * @param {LongbridgeHoldingRow} holding
 * @param {boolean} selected
 * @param {number} rowIndex
 */
export function holdingRow(tokens, holding, selected = false, rowIndex = 0) {
  const todayTone = valueTone(tokens, holding.todayPnlValue);
  const totalTone = valueTone(tokens, holding.totalPnlValue);
  const cell = (column, build) =>
    build(TableCell.new(`holding-${holding.symbol}-${column}`, column));
  return interactiveTableRow(
    tokens,
    TableRow.new(`holding-${holding.symbol}`, rowIndex + 2)
      .flex()
      .items_center()
      .w_full()
      .h(HOLDING_ROW_HEIGHT)
      .gap(tokens.spacing.sm)
      .px(tokens.spacing.sm)
      .py(tokens.spacing.xs)
      .border_b(1)
      .border_color(tokens.border),
    selected,
  )
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

const ORDER_COLUMNS = [
  { title: "Instrument", size: (el) => el.w("25%") },
  { title: "Side", size: (el) => el.w("12%") },
  { title: "Status", size: (el) => el.w("19%") },
  { title: "Filled", size: (el) => el.w("14%"), align: (el) => el.justify_end() },
  { title: "Price", size: (el) => el.w("15%"), align: (el) => el.justify_end() },
  { title: "Submitted", size: (el) => el.flex_1(), align: (el) => el.justify_end() },
];

/**
 * The two order tables are one table twice, so the id is a parameter: a header
 * that named itself would give Today and History the same cell identities.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {string} id
 */
export function ordersHeader(tokens, id) {
  return tableHeaderRow(tokens, id, ORDER_COLUMNS);
}

/** The height Orders rows are drawn at. Two lines and a hairline, as Holdings. */
export const ORDER_ROW_HEIGHT = 42;

/**
 * The colour an order's outcome is drawn in.
 *
 * A status is not a signed number, so it does not go through `valueTone`: it
 * is filled, still working, refused, or over. Only the first two are readings
 * a market colour belongs to; the rest stay in the interface's own foregrounds
 * so a list of cancellations does not look like a list of losses.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {string} kind
 */
export function orderStatusTone(tokens, kind) {
  const status = statusColors(tokens);
  if (kind === "filled") return status.up;
  if (kind === "working") return status.info;
  if (kind === "rejected") return status.down;
  return tokens.muted_foreground;
}

/**
 * One order, as two lines per column: what was asked for over what happened.
 *
 * The columns are the Longbridge terminal's -- instrument, side, type, status,
 * quantity, executed quantity, price and time -- folded in half. A desktop row
 * has two lines where a TUI row has one, so each pair that is only ever read
 * together shares a column instead of taking one of its own.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {LongbridgeOrderRow} order
 * @param {number} rowIndex
 * @param {boolean} [selected] Whether the detail panel is showing this order.
 */
export function orderRow(tokens, order, rowIndex = 0, selected = false) {
  const status = statusColors(tokens);
  const sideTone =
    order.sideKind === "buy"
      ? status.up
      : order.sideKind === "sell"
        ? status.down
        : tokens.foreground;
  const seconds = order.submittedAt > 0 ? Math.trunc(order.submittedAt / 1_000) : null;
  const time = seconds === null ? "--" : formatMarketTime(order.symbol, seconds, true);
  const day = seconds === null ? "" : formatMarketDate(order.symbol, seconds);
  const cell = (column, build) => build(TableCell.new(`order-${order.orderId}-${column}`, column));
  return interactiveTableRow(
    tokens,
    TableRow.new(`order-${order.orderId}`, rowIndex + 2)
      .flex()
      .items_center()
      .w_full()
      .h(ORDER_ROW_HEIGHT)
      .gap(tokens.spacing.sm)
      .px(tokens.spacing.sm)
      .py(tokens.spacing.xs)
      .border_b(1)
      .border_color(tokens.border),
    selected,
  )
    .child(
      cell(1, (element) =>
        element
          .flex()
          .flex_col()
          .w("25%")
          .min_w(0)
          .gap(tokens.spacing.xxs)
          .child(label(tokens, order.symbol).truncate())
          .child(muted(tokens, order.name).truncate()),
      ),
    )
    .child(
      cell(2, (element) =>
        element
          .flex()
          .flex_col()
          .w("12%")
          .min_w(0)
          .gap(tokens.spacing.xxs)
          .child(label(tokens, order.sideLabel).text_color(sideTone).truncate())
          .child(muted(tokens, order.type).truncate()),
      ),
    )
    .child(
      cell(3, (element) =>
        element
          .flex()
          .flex_col()
          .w("19%")
          .min_w(0)
          .gap(tokens.spacing.xxs)
          .child(
            label(tokens, order.statusLabel)
              .text_color(orderStatusTone(tokens, order.statusKind))
              .truncate(),
          )
          .child(muted(tokens, order.message || order.remark || "").truncate()),
      ),
    )
    .child(
      cell(4, (element) =>
        element
          .flex()
          .flex_col()
          .w("14%")
          .min_w(0)
          .items_end()
          .gap(tokens.spacing.xxs)
          .child(numeric(tokens, order.executedQuantity).truncate())
          .child(muted(tokens, `of ${order.quantity}`).truncate()),
      ),
    )
    .child(
      cell(5, (element) =>
        element
          .flex()
          .flex_col()
          .w("15%")
          .min_w(0)
          .items_end()
          .gap(tokens.spacing.xxs)
          .child(numeric(tokens, order.price).truncate())
          .child(muted(tokens, order.executedPrice).truncate()),
      ),
    )
    .child(
      cell(6, (element) =>
        element
          .flex()
          .flex_col()
          .flex_1()
          .min_w(0)
          .items_end()
          .gap(tokens.spacing.xxs)
          .child(numeric(tokens, time).truncate())
          .child(muted(tokens, day).truncate()),
      ),
    );
}

/**
 * One order in full, as the sheet a right-hand panel carries.
 *
 * The Longbridge terminal answers a click with a label/value sheet in three
 * groups -- what was ordered, what happened to it, and when -- and this is
 * that sheet. Rows whose value the API did not send are left out rather than
 * drawn as a dash: a panel of dashes reads as missing data, and what is
 * actually true is that the order has no trigger and was never amended.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {LongbridgeOrderRow} order
 */
export function orderDetail(tokens, order) {
  const status = statusColors(tokens);
  const sideTone =
    order.sideKind === "buy"
      ? status.up
      : order.sideKind === "sell"
        ? status.down
        : tokens.foreground;
  const stamp = (value) => {
    if (!value) return "";
    const seconds = Math.trunc(value / 1_000);
    return `${formatMarketDate(order.symbol, seconds)} ${formatMarketTime(order.symbol, seconds, true)}`;
  };
  const section = (title, entries) =>
    v_flex()
      .gap(tokens.spacing.sm)
      .child(smallCaps(tokens, title))
      .child(
        detailGrid(
          tokens,
          entries.filter((entry) => entry.value),
        ),
      );
  const amount = (value) =>
    value === "--" || value === "" ? "" : order.currency ? `${value} ${order.currency}` : value;
  return v_flex()
    .id(`order-detail-${order.orderId}`)
    .w_full()
    .gap(tokens.spacing.md)
    .px(tokens.spacing.md)
    .py(tokens.spacing.md)
    .child(
      v_flex()
        .gap(tokens.spacing.xxs)
        .child(label(tokens, order.symbol, 14).font_weight(700).truncate())
        .child(muted(tokens, order.name).truncate())
        .child(
          h_flex()
            .items_center()
            .gap(tokens.spacing.xs)
            .child(
              label(tokens, order.statusLabel).text_color(
                orderStatusTone(tokens, order.statusKind),
              ),
            )
            .child(muted(tokens, "·"))
            .child(label(tokens, order.sideLabel).text_color(sideTone))
            .child(muted(tokens, order.type)),
        ),
    )
    .child(rule(tokens))
    .child(
      section("Order", [
        { title: "Time in force", value: order.timeInForce },
        { title: "Currency", value: order.currency },
        { title: "Outside RTH", value: order.outsideRth },
        { title: "Channel", value: order.tag },
      ]),
    )
    .child(
      section("Execution", [
        { title: "Quantity", value: order.quantity },
        { title: "Filled", value: order.executedQuantity },
        { title: "Price", value: amount(order.price) },
        { title: "Filled price", value: amount(order.executedPrice) },
        { title: "Last done", value: amount(order.lastDone) },
        { title: "Trigger price", value: amount(order.triggerPrice) },
      ]),
    )
    .child(
      section("Timing", [
        { title: "Submitted", value: stamp(order.submittedAt) },
        { title: "Updated", value: stamp(order.updatedAt) },
      ]),
    )
    .child(rule(tokens))
    .child(
      v_flex()
        .gap(tokens.spacing.xxs)
        .child(muted(tokens, "Order ID"))
        .child(numeric(tokens, order.orderId).truncate()),
    )
    .when(Boolean(order.remark), (element) =>
      element.child(
        v_flex()
          .gap(tokens.spacing.xxs)
          .child(muted(tokens, "Remark"))
          .child(label(tokens, order.remark)),
      ),
    )
    .when(Boolean(order.message), (element) => element.child(muted(tokens, order.message)));
}

/**
 * The device code, as the thing the sign-in screen is actually about.
 *
 * Spaced by hand: the runtime exposes no letter-spacing, and a code that has
 * to be copied off a screen and typed into a phone is worth the character gaps
 * more than most text is.
 *
 * @param {import("gpui-base").Theme} tokens
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
      numeric(tokens, code.split("").join(" "), 24).font_weight(700).text_color(tokens.foreground),
    );
}

/**
 * A numbered step. Sign-in is a three-place errand — open a page, type a code,
 * approve — and the screen says so rather than leaving it to be inferred from
 * the order of the controls.
 *
 * @param {import("gpui-base").Theme} tokens
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
        .rounded(tokens.radius.none)
        .bg(tokens.secondary)
        .child(numeric(tokens, index, 10).text_color(tokens.secondary_foreground)),
    )
    .child(muted(tokens, title));
}

/** @param {import("gpui-base").Theme} tokens @param {string} title @param {string} detail */
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

/** @param {import("gpui-base").Theme} tokens @param {string} value */
export function errorMessage(tokens, value) {
  return h_flex()
    .w_full()
    .gap(tokens.spacing.sm)
    .p(tokens.spacing.sm)
    .rounded(tokens.radius.sm)
    .border(1)
    .border_color(tokens.destructive)
    .bg(tokens.surface)
    .child(div().w(3).self_stretch().rounded(tokens.radius.none).bg(tokens.destructive))
    .child(
      div()
        .flex_1()
        .min_w(0)
        .whitespace_normal()
        .text_size(12)
        .line_height(1.35)
        .text_color(tokens.foreground)
        .child(value),
    );
}

// ---------------------------------------------------------------------------
// Base components the shell bound in
// https://github.com/longbridge/gpui-component/pull/2847. Each is used where
// the terminal already had the problem it solves, so what is on screen is also
// what verifies the binding.
// ---------------------------------------------------------------------------

/**
 * The two-letter badge that opens a watchlist row.
 *
 * `Avatar` picks between its two slots and draws nothing else, so the shape,
 * the size and the type are all written here. It is a square block rather than
 * a disc: this interface has no circles in it, and two letters in a filled
 * square is what a terminal writes a badge as. This one has no image on
 * purpose: there is no per-market artwork in the application directory, and an
 * avatar whose image never resolves is exactly the case the fallback exists
 * for.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {string} market
 * @param {number} [size]
 */
export function marketAvatar(tokens, code, size = 26) {
  // One letter, from the ticker rather than from the market.
  //
  // Every row of a market's block carried the same two letters, so the column
  // was a stripe that said what the Session column already says. The ticker's
  // own initial differs row to row, which is what makes it a mark you can find
  // a row by rather than a label repeated down the page.
  //
  // A leading `.` is an index -- `.SPX.US` -- and a leading digit is a Hong
  // Kong or A-share board number; neither is a letter to lead with, so the
  // first character that is one wins, and a code with none keeps its first.
  const bare = String(code || "").replace(/^\.+/, "");
  const letter = bare.match(/[A-Za-z]/)?.[0] ?? bare[0] ?? "-";
  const initials = letter.toUpperCase();
  const fill = avatarColor(tokens, initials, 0.14);
  const border = avatarColor(tokens, initials, 0.3);
  const tone = avatarColor(tokens, initials, 0.6);
  return Avatar.new()
    .flex_none()
    .w(size)
    .h(size)
    .rounded(tokens.radius.sm)
    .overflow_hidden()
    .border(1)
    .border_color(border)
    .bg(fill)
    .fallback(
      AvatarFallback.new()
        .size_full()
        .flex()
        .items_center()
        .justify_center()
        .text_size(12)
        .line_height(1)
        .font_weight(700)
        .text_color(tone)
        .child(initials),
    );
}

/**
 * The session menu's trigger: an avatar with no picture behind it.
 *
 * The counterpart of `marketAvatar` — both fill the fallback slot, because
 * this application knows no faces. A read-only terminal is signed in to an
 * account, not to a person with a portrait, and the product mark is already
 * in the header two elements to the left; putting it in a circle here would
 * repeat it and crop its bars against the mask.
 *
 * So the fallback is what an avatar with nothing to show is everywhere else:
 * a head and a pair of shoulders, drawn as `assets/user.svg` — one icon on the
 * same 24×24 grid and 2px stroke as the theme toggle and the dock's panel
 * marks, rather than a person assembled out of two rounded containers. It
 * takes its colour from the button's `text_color` through `currentColor`, so
 * the mark follows the trigger's state instead of pinning its own fill.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {string} id
 * @param {string} hint
 * @param {boolean} [open]
 */
export function sessionAvatar(tokens, id, hint, open = false) {
  return Button.new(id)
    .accessibility_label(hint)
    .tooltip(hint)
    .selected(open)
    .flex()
    .items_center()
    .justify_center()
    .w(26)
    .h(26)
    .flex_none()
    .rounded(tokens.radius.sm)
    .border(1)
    .border_color(open ? tokens.ring : tokens.border)
    .bg(open ? tokens.accent : tokens.surface)
    .text_color(open ? tokens.accent_foreground : tokens.muted_foreground)
    .hover((style) => style.border_color(tokens.ring))
    .focus((style) => style.border_color(tokens.ring))
    .child(
      Avatar.new()
        .w(20)
        .h(20)
        .rounded(tokens.radius.sm)
        .overflow_hidden()
        .fallback(
          AvatarFallback.new()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .child(icon("assets/user.svg")),
        ),
    );
}

/**
 * One collapsible section of the stock-detail pane.
 *
 * None of the five accordion parts draws anything — they carry the group, the
 * heading and its level, the button and its expanded state, and the region
 * that button controls — so the chevron, the rule and the padding are all
 * written here.
 *
 * `keepMounted` is not decoration either: the price chart is a retained child
 * view, and a panel that left the tree on every collapse would tear it down
 * and rebuild it.
 *
 * `inset` is the horizontal padding of the trigger row, so a disclosure can
 * line its chevron up with whatever content it sits under rather than with
 * whatever this file happened to choose.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {{
 *   id: string,
 *   title: string,
 *   detail?: string,
 *   open: boolean,
 *   level?: number,
 *   keepMounted?: boolean,
 *   inset?: number,
 *   onToggle: (open: boolean, cx: import("gpui").Context) => void,
 *   body: import("gpui").Element,
 * }} options
 */
export function accordionSection(tokens, options) {
  const {
    id,
    title,
    detail = "",
    open,
    level = 3,
    keepMounted = false,
    inset = tokens.spacing.md,
    onToggle,
    body,
  } = options;
  return AccordionItem.new()
    .open(open)
    .w_full()
    .header(
      AccordionHeader.new(
        AccordionTrigger.new(`${id}-trigger`)
          .on_change(onToggle)
          .flex()
          .w_full()
          // The hover is on a plain element inside the trigger rather than on
          // the trigger. A component is rebuilt from its description as a
          // value, so there is no interactive element on it for a hover to
          // land on -- the runtime says so in the log -- and this row fills the
          // trigger, so the lit area is the same one either way.
          .child(
            h_flex()
              .id(`${id}-trigger-surface`)
              .w_full()
              .items_center()
              .justify_between()
              .gap(tokens.spacing.sm)
              .px(inset)
              .py(tokens.spacing.sm)
              .hover((style) => style.bg(tokens.accent))
              .child(
                h_flex()
                  .items_center()
                  .gap(tokens.spacing.xs)
                  .child(
                    div()
                      .w(14)
                      .text_size(14)
                      .line_height(1)
                      .text_color(tokens.foreground)
                      .child(open ? "▾" : "▸"),
                  )
                  .child(label(tokens, title)),
              )
              .when(Boolean(detail), (element) => element.child(muted(tokens, detail))),
          ),
      ).aria_level(level),
    )
    .panel(
      AccordionPanel.new()
        .keep_mounted(keepMounted)
        .w_full()
        .when(open, (element) => element.child(rule(tokens)))
        .child(body),
    );
}

/**
 * The accordion group the sections above sit in.
 *
 * @param {string} id
 */
export function accordionGroup(id) {
  return Accordion.new(id).flex().flex_col().w_full();
}

/** The weekday headings the grid's columns line up under. */
const WEEKDAYS = Object.freeze(["S", "M", "T", "W", "T", "F", "S"]);

/**
 * A month grid drawn from a retained `CalendarState`.
 *
 * Base's `Calendar` element is not bound — it would cross into JavaScript once
 * per cell from inside the layout pass — so the state answers the grid and the
 * cells are ordinary buttons. `month_days()` is the part a script cannot work
 * out for itself: which days fall in which week, and which of them belong to
 * the neighbouring months.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {import("gpui-base").CalendarStateHandle} calendar
 * @param {{
 *   selected: string | null,
 *   latest: string,
 *   onPick: (day: string, cx: import("gpui").Context) => void,
 *   onMonth: (delta: number, cx: import("gpui").Context) => void,
 * }} options
 */
export function calendarGrid(tokens, calendar, options) {
  const { selected, latest, onPick, onMonth } = options;
  const weeks = calendar.month_days()[0] ?? [];
  const year = calendar.year();
  const month = calendar.month();
  const monthLabel = `${year}-${String(month).padStart(2, "0")}`;
  const inMonth = (day) => day.slice(0, 7) === monthLabel;
  const step = (id, caption, delta) =>
    Button.new(id)
      .accessibility_label(caption)
      .tooltip(caption)
      .flex()
      .items_center()
      .justify_center()
      .w(22)
      .h(22)
      .rounded(tokens.radius.sm)
      .border(1)
      .border_color(tokens.border)
      .bg(tokens.surface)
      .text_size(11)
      .text_color(tokens.muted_foreground)
      .hover((style) => style.bg(tokens.accent).text_color(tokens.accent_foreground))
      .focus((style) => style.border_color(tokens.ring))
      .on_click((_event, cx) => onMonth(delta, cx))
      .child(delta < 0 ? "‹" : "›");

  return v_flex()
    .gap(tokens.spacing.xs)
    .child(
      h_flex()
        .items_center()
        .justify_between()
        .child(step("calendar-prev", "Previous month", -1))
        .child(label(tokens, monthLabel))
        .child(step("calendar-next", "Next month", 1)),
    )
    .child(
      h_flex()
        .w_full()
        .children(
          WEEKDAYS.map((day, index) =>
            div()
              .flex()
              .flex_1()
              .justify_center()
              .text_size(10)
              .line_height(1.6)
              .text_color(tokens.muted_foreground)
              .id(`calendar-weekday-${index}`)
              .child(day),
          ),
        ),
    )
    .children(
      weeks.map((week, weekIndex) =>
        h_flex()
          .w_full()
          .gap(1)
          .id(`calendar-week-${weekIndex}`)
          .children(
            week.map((day) => {
              const current = day === selected;
              const future = day > latest;
              return Button.new(`calendar-day-${day}`)
                .selected(current)
                .disabled(future)
                .accessibility_label(day)
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .h(22)
                .rounded(tokens.radius.sm)
                .text_size(10)
                .line_height(1)
                .bg(current ? tokens.primary : tokens.surface)
                .text_color(
                  current
                    ? tokens.primary_foreground
                    : inMonth(day)
                      ? tokens.foreground
                      : tokens.muted_foreground,
                )
                .opacity(future ? 0.35 : inMonth(day) ? 1 : 0.6)
                .when(!future && !current, (element) =>
                  element.hover((style) =>
                    style.bg(tokens.accent).text_color(tokens.accent_foreground),
                  ),
                )
                .when(!future, (element) => element.on_click((_event, cx) => onPick(day, cx)))
                .child(String(Number(day.slice(8))));
            }),
          ),
      ),
    );
}

/**
 * One chord, drawn as a key.
 *
 * `KeyEvent.keystroke` arrives already unparsed — the whole chord, spelled the
 * same on every platform — so this is a label rather than a reconstruction.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {string} keystroke
 * @param {{ down?: boolean, held?: boolean }} [state] Whether the key is still
 *   down, and whether the platform is repeating it.
 */
export function kbd(tokens, keystroke, state = {}) {
  const { down = false, held = false } = state;
  const quietFill = /^#[0-9a-f]{6}$/i.test(tokens.muted) ? `${tokens.muted}80` : tokens.muted;
  return (
    div()
      .flex_none()
      .px(tokens.spacing.xs)
      .py(1)
      .rounded(tokens.radius.sm)
      .border(1)
      .border_color(down ? tokens.ring : tokens.border)
      // Status-bar shortcuts are supporting metadata, not buttons. Fade only
      // the resting fill; the label and border stay fully legible, and a key
      // that is physically down keeps the full-strength accent response.
      .bg(down ? tokens.accent : quietFill)
      .text_size(10)
      .line_height(1.4)
      // No family here either, for the reason `numeric` gives: the root sets the
      // one the whole window inherits, and a key cap is the last place that
      // should be the single element drawn in a different face.
      .text_color(down ? tokens.accent_foreground : tokens.muted_foreground)
      .child(held ? `${keystroke} (held)` : keystroke)
  );
}

/**
 * The page inset. Combined with the same small gap between Panels, it keeps
 * the title bar, window edge and all four Panel outlines on one spacing grid.
 */
export const PANE_INSET = 4;
export const WATCHLIST_MIN_WIDTH = 400;

/**
 * A plain titled Panel with an optional compact TitleBar accessory.
 *
 * `grow` is how the content is sized. A pane whose content fills whatever it
 * is given -- a table, a plot, a tape -- grows into the panel; a pane that is
 * a fixed block of readings takes its own height instead, because a block of
 * readings stretched to fill a tall window is a band of empty panel under the
 * last row of it.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {string} title
 * @param {import("gpui").Element} content
 * `note` is what the title alone cannot say: a count, a currency, a window of
 * days. It sits with the heading rather than across the row from it, because
 * it says how much of *this* is here; opposite the title it read as a second
 * control.
 *
 * @param {import("gpui").Element | null} [accessory]
 * @param {{ grow?: boolean, note?: string }} [options]
 */
export function workspacePanel(tokens, title, content, accessory = null, options = {}) {
  const { grow = true, note = "" } = options;
  return panel(tokens)
    .min_w(0)
    .min_h(0)
    .child(
      h_flex()
        .h(30)
        .flex_none()
        .items_center()
        .justify_between()
        .gap(tokens.spacing.sm)
        .px(tokens.spacing.sm)
        .border_b(1)
        .border_color(tokens.border)
        .child(
          h_flex()
            .items_baseline()
            .min_w(0)
            .gap(tokens.spacing.xs)
            .child(label(tokens, title, 13).font_weight(700))
            .when(Boolean(note), (element) => element.child(muted(tokens, note).truncate())),
        )
        .when(accessory, (element) => element.child(accessory)),
    )
    .child(grow ? content.border(0).flex_1().min_h(0) : content.border(0).flex_none());
}
