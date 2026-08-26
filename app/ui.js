// Compact presentation primitives for the read-only terminal. Every visual
// decision resolves from the call-scoped semantic theme.

import { Button, Link, div, h_flex, svg, text, v_flex } from "gpui";
import { formatCompactNumber, quoteFreshness, tradeStatusLabel } from "./market.js";

/** @param {import("gpui").Theme} tokens @param {string | number} value @param {number} [size] */
export const label = (tokens, value, size = 12) =>
  text(value).text_size(size).line_height(1.25).text_color(tokens.foreground);

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
  const dark = tokens.mode === "dark";
  return Button.new("theme-toggle")
    .accessibility_label(dark ? "Switch to light theme" : "Switch to dark theme")
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

/** @param {import("gpui").Theme} tokens */
export function watchlistHeader(tokens) {
  return h_flex()
    .items_center()
    .gap(tokens.spacing.sm)
    .px(tokens.spacing.sm)
    .py(tokens.spacing.xs)
    .bg(tokens.muted)
    .child(muted(tokens, "Instrument").w("31%"))
    .child(muted(tokens, "Last").w("19%").text_right())
    .child(muted(tokens, "Change").w("18%").text_right())
    .child(muted(tokens, "Volume").w("16%").text_right())
    .child(muted(tokens, "Session").flex_1().text_right());
}

/**
 * @param {import("gpui").Theme} tokens
 * @param {LongbridgeQuoteRow} quote
 * @param {boolean} selected
 * @param {(event: import("gpui").ClickEvent, cx: import("gpui").Context) => void} onSelect
 * @param {number} [now]
 */
export function quoteRow(tokens, quote, selected, onSelect, now = Date.now()) {
  const tone = quote.change.startsWith("-")
    ? tokens.destructive
    : quote.change.startsWith("+")
      ? tokens.primary
      : tokens.foreground;
  const freshness = quoteFreshness(quote, now).toUpperCase();
  return Button.new(`quote-${quote.symbol}`)
    .selected(selected)
    .on_click(onSelect)
    .flex()
    .items_center()
    .w_full()
    .gap(tokens.spacing.sm)
    .px(tokens.spacing.sm)
    .py(tokens.spacing.xs)
    .border(0)
    .border_b(1)
    .border_color(tokens.border)
    .bg(selected ? tokens.accent : tokens.surface)
    .opacity(quote.receivedAt ? 1 : 0.68)
    .transition("opacity", { duration: 160, easing: "ease-out" })
    .text_color(selected ? tokens.accent_foreground : tokens.foreground)
    .hover((style) => style.bg(tokens.accent).text_color(tokens.accent_foreground))
    .focus((style) => style.bg(tokens.accent).text_color(tokens.accent_foreground))
    .child(
      v_flex()
        .w("31%")
        .gap(tokens.spacing.xxs)
        .child(label(tokens, quote.code))
        .child(muted(tokens, quote.name)),
    )
    .child(
      v_flex()
        .w("19%")
        .items_end()
        .gap(tokens.spacing.xxs)
        .child(label(tokens, quote.last))
        .child(muted(tokens, quote.currency)),
    )
    .child(
      v_flex()
        .w("18%")
        .items_end()
        .gap(tokens.spacing.xxs)
        .child(label(tokens, quote.changePercent).text_color(tone))
        .child(label(tokens, quote.change).text_color(tone)),
    )
    .child(
      h_flex()
        .w("16%")
        .justify_end()
        .child(muted(tokens, formatCompactNumber(quote.volume))),
    )
    .child(
      v_flex()
        .flex_1()
        .items_end()
        .gap(tokens.spacing.xxs)
        .child(muted(tokens, tradeStatusLabel(quote)))
        .child(muted(tokens, freshness)),
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
          .child(label(tokens, entry.value, 13)),
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
    .opacity(quote.receivedAt ? pulseOpacity : 0.72)
    .transition("opacity", { duration: 180, easing: "ease-out" })
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
            .items_end()
            .gap(tokens.spacing.xs)
            .child(label(tokens, quote.last, 28))
            .child(label(tokens, `${quote.change} · ${quote.changePercent}`, 13).text_color(tone)),
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

/** @param {import("gpui").Theme} tokens @param {LongbridgeHoldingRow} holding */
export function holdingRow(tokens, holding) {
  return h_flex()
    .id(`holding-${holding.symbol}`)
    .items_center()
    .gap(tokens.spacing.md)
    .px(tokens.spacing.md)
    .py(tokens.spacing.sm)
    .border_b(1)
    .border_color(tokens.border)
    .hover((style) => style.bg(tokens.muted))
    .child(
      v_flex()
        .w("28%")
        .gap(tokens.spacing.xxs)
        .child(label(tokens, holding.symbol))
        .child(muted(tokens, holding.name)),
    )
    .child(h_flex().w("16%").justify_end().child(label(tokens, holding.quantity)))
    .child(h_flex().w("16%").justify_end().child(label(tokens, holding.available)))
    .child(h_flex().w("20%").justify_end().child(label(tokens, holding.costPrice)))
    .child(h_flex().flex_1().justify_end().child(muted(tokens, holding.currency)));
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
