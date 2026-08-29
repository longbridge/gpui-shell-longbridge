import { Background, PathBuilder, View, div } from "gpui";
import { Progress, ProgressIndicator, ProgressTrack, h_flex, v_flex } from "gpui-base";
import {
  findNearestPricePoint,
  formatMarketDate,
  formatMarketTime,
  layoutIntradaySeries,
  layoutPriceSeries,
  priceWindowChange,
} from "./chart.js";
import { layoutCandles } from "./candlestick_chart.js";
import { valueTone } from "./palette.js";
import { label, muted, numeric } from "./ui.js";

export const PRICE_CHART_LAYOUT = Object.freeze({ width: 480, height: 132, dayGap: 8 });

const TYPE = Object.freeze({ bodySmall: 11, body: 12 });
const MARKER_SIZE = 6;
const INTRADAY_POINT_LIMIT = 240;
const CANDLE_MODES = new Set(["1m", "5m", "15m", "1D"]);
const SESSION_LABELS = Object.freeze({
  0: "Regular",
  1: "Pre-market",
  2: "Post-market",
  3: "Overnight",
});

/** @param {number} value @param {number} total @returns {`${number}%`} */
function percentage(value, total) {
  return /** @type {`${number}%`} */ (`${total > 0 ? (value / total) * 100 : 0}%`);
}

/** @param {number} value @returns {`${number}%`} */
function clampPercentage(value) {
  return /** @type {`${number}%`} */ (`${Math.min(100, Math.max(0, value))}%`);
}

function chartTitle(mode) {
  if (mode === "intraday") return "Intraday";
  return CANDLE_MODES.has(mode) ? `${mode} candles` : "5D intraday";
}

function candleDirection(candle) {
  const open = Number(candle?.geometry?.open ?? candle?.open);
  const close = Number(candle?.geometry?.close ?? candle?.close);
  return Number.isFinite(open) && Number.isFinite(close) ? close - open : 0;
}

function sessionTone(tokens, session) {
  return session === 0 ? valueTone(tokens, 1) : tokens.muted_foreground;
}

function sessionOpacity(session) {
  if (session === 0) return 1;
  if (session === 1) return 0.76;
  if (session === 2) return 0.62;
  return 0.48;
}

function formatValue(value) {
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  return Number.isFinite(value) ? String(value) : "--";
}

/** @param {PriceChartLaidOutPoint} point @param {PriceChartGeometry} geometry */
function markerBlock(point, geometry) {
  const halfX = geometry.width > 0 ? (MARKER_SIZE / 2 / geometry.width) * 100 : 0;
  const halfY = geometry.height > 0 ? (MARKER_SIZE / 2 / geometry.height) * 100 : 0;
  const centerX = geometry.width > 0 ? (point.x / geometry.width) * 100 : 0;
  const centerY = geometry.height > 0 ? (point.y / geometry.height) * 100 : 0;
  return PathBuilder.fill()
    .move_to(clampPercentage(centerX - halfX), clampPercentage(centerY - halfY))
    .line_to(clampPercentage(centerX + halfX), clampPercentage(centerY - halfY))
    .line_to(clampPercentage(centerX + halfX), clampPercentage(centerY + halfY))
    .line_to(clampPercentage(centerX - halfX), clampPercentage(centerY + halfY))
    .close()
    .build();
}

function candleBodyPath(candle) {
  const top = candle.body.top;
  const bottom = candle.body.bottom === top ? Math.min(100, top + 0.75) : candle.body.bottom;
  return PathBuilder.fill()
    .move_to(`${candle.body.left}%`, `${top}%`)
    .line_to(`${candle.body.right}%`, `${top}%`)
    .line_to(`${candle.body.right}%`, `${bottom}%`)
    .line_to(`${candle.body.left}%`, `${bottom}%`)
    .close()
    .build();
}

function candleWickPath(candle) {
  return PathBuilder.stroke(1)
    .move_to(`${candle.wick.x}%`, `${candle.wick.top}%`)
    .line_to(`${candle.wick.x}%`, `${candle.wick.bottom}%`)
    .build();
}

function candleDate(symbol, candle) {
  return typeof candle?.marketDay === "string" && candle.marketDay
    ? candle.marketDay
    : formatMarketDate(symbol, candle?.timestamp);
}

function candleAxisLabel(symbol, mode, candle) {
  const date = candleDate(symbol, candle);
  if (mode === "1D") return date;
  const time = formatMarketTime(symbol, candle?.timestamp);
  return `${date.slice(5)} ${time}`.trim();
}

function candleAxisTicks(candles) {
  if (candles.length <= 1) return candles;
  const middle = candles[Math.floor((candles.length - 1) / 2)];
  return [candles[0], middle, candles.at(-1)].filter(
    (item, index, ticks) =>
      ticks.findIndex((candidate) => candidate.timestamp === item.timestamp) === index,
  );
}

function candleAxisTick(tokens, symbol, mode, item) {
  const x = item.wick.x;
  const axisLabel = muted(tokens, candleAxisLabel(symbol, mode, item))
    .absolute()
    .top(2)
    .w(80)
    .min_w(0)
    .truncate();
  return div()
    .id(`candlestick-axis-tick-${item.timestamp}`)
    .absolute()
    .left(`${x}%`)
    .top(0)
    .w(1)
    .h_full()
    .child(div().w(1).h(3).bg(tokens.border))
    .child(
      x <= 10
        ? axisLabel.left(0).text_left()
        : x >= 90
          ? axisLabel.right(0).text_right()
          : axisLabel.left(-40).text_center(),
    );
}

function retainIntradayExtrema(points, budget, hasSessionBoundary) {
  if (points.length <= budget) return points;
  // Later segments overlap the preceding session by one connector point. The
  // real first trade of the newly labelled session is index 1, so it remains
  // mandatory alongside the connector, final trade, and bucket extrema.
  const mandatory = new Set([0, points.length - 1]);
  if (hasSessionBoundary && points.length > 1) mandatory.add(1);
  let overallLow = 0;
  let overallHigh = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].close < points[overallLow].close) overallLow = index;
    if (points[index].close > points[overallHigh].close) overallHigh = index;
  }
  mandatory.add(overallLow);
  mandatory.add(overallHigh);
  const bucketCount = Math.max(0, Math.floor((budget - mandatory.size) / 2));
  const extrema = new Set();
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const first = Math.floor((bucket * points.length) / bucketCount);
    const last = Math.max(first + 1, Math.floor(((bucket + 1) * points.length) / bucketCount));
    let low = first;
    let high = first;
    for (let index = first + 1; index < last; index += 1) {
      if (points[index].close < points[low].close) low = index;
      if (points[index].close > points[high].close) high = index;
    }
    extrema.add(low);
    extrema.add(high);
  }
  return [
    ...mandatory,
    ...[...extrema]
      .sort((left, right) => left - right)
      .filter((index) => !mandatory.has(index))
      .slice(0, Math.max(0, budget - mandatory.size)),
  ]
    .sort((left, right) => left - right)
    .map((index) => points[index]);
}

/**
 * Bounds full-session paint work while retaining every provider session and
 * the extrema that would otherwise disappear between device pixels.
 */
export function layoutIntradayForView(series, layout) {
  const geometry = layoutIntradaySeries(series, layout);
  const total = geometry.sessionSegments.reduce((sum, segment) => sum + segment.points.length, 0);
  if (total <= INTRADAY_POINT_LIMIT) return geometry;
  const minimums = geometry.sessionSegments.map((_segment, index) => (index === 0 ? 4 : 5));
  let remaining = INTRADAY_POINT_LIMIT - minimums.reduce((sum, minimum) => sum + minimum, 0);
  let remainingPoints = total;
  const sessionSegments = geometry.sessionSegments.map((segment, index) => {
    const segmentsAfter = geometry.sessionSegments.length - index - 1;
    const extra =
      segmentsAfter === 0
        ? remaining
        : Math.floor((remaining * segment.points.length) / remainingPoints);
    const budget = minimums[index] + Math.max(0, extra);
    const points = Object.freeze(retainIntradayExtrema(segment.points, budget, index > 0));
    remaining -= budget - minimums[index];
    remainingPoints -= segment.points.length;
    return Object.freeze({ ...segment, points });
  });
  return Object.freeze({
    ...geometry,
    points: Object.freeze(sessionSegments.flatMap((segment) => segment.points)),
    sessionSegments: Object.freeze(sessionSegments),
  });
}

/** Shrinks the retained-view prop graph before it crosses the nested update bridge. */
export function compactIntradaySeriesForView(series, layout) {
  if (!series || !Array.isArray(series.candles)) return series;
  const geometry = layoutIntradayForView(series, layout);
  if (series.candles.length <= INTRADAY_POINT_LIMIT) return series;
  const seen = new Set();
  const candles = [];
  for (const point of geometry.points) {
    const identity = String(point.timestamp);
    if (seen.has(identity)) continue;
    seen.add(identity);
    candles.push(
      Object.freeze({
        timestamp: point.timestamp,
        close: point.close,
        tradeSession: point.tradeSession,
        ...(point.marketDay === undefined ? {} : { marketDay: point.marketDay }),
      }),
    );
  }
  const sessionBoundaries = [];
  let previousSession = Symbol("first session");
  for (let index = 0; index < candles.length; index += 1) {
    if (candles[index].tradeSession === previousSession) continue;
    sessionBoundaries.push(
      Object.freeze({
        index,
        timestamp: candles[index].timestamp,
        tradeSession: candles[index].tradeSession,
        marketDay: candles[index].marketDay,
      }),
    );
    previousSession = candles[index].tradeSession;
  }
  return Object.freeze({
    candles: Object.freeze(candles),
    sessionBoundaries: Object.freeze(sessionBoundaries),
    ...(series.previousClose === undefined ? {} : { previousClose: series.previousClose }),
  });
}

/** The retained invalidation boundary for chart geometry and hover interaction. */
export default class PriceChartView extends View {
  init(props) {
    this.hoveredTimestamp = null;
    this.applyProps(props);
  }

  update(props) {
    this.applyProps(props);
  }

  applyProps(props) {
    const previousSymbol = this.symbol;
    const previousMode = this.mode;
    const previousSeries = this.chartSeries;
    const previousLayout = this.layout;
    const previousTheme = this.themeRevision;
    this.symbol = props.symbol;
    this.mode = props.mode ?? "5D";
    this.chartSeries = props.chartSeries;
    this.state = props.state;
    this.layout = props.layout;
    this.themeRevision = props.themeRevision;

    if (
      previousSeries !== this.chartSeries ||
      previousMode !== this.mode ||
      previousLayout?.width !== this.layout.width ||
      previousLayout?.height !== this.layout.height ||
      previousLayout?.dayGap !== this.layout.dayGap ||
      previousTheme !== this.themeRevision
    ) {
      if (this.mode === "intraday")
        this.geometry = layoutIntradayForView(this.chartSeries, this.layout);
      else if (CANDLE_MODES.has(this.mode))
        this.geometry = layoutCandles(this.chartSeries, this.layout);
      else this.geometry = layoutPriceSeries(this.chartSeries, this.layout);
    }
    if (previousSymbol !== this.symbol || previousMode !== this.mode) this.hoveredTimestamp = null;
    this.hoveredPoint = this.itemForTimestamp(this.hoveredTimestamp);
    if (this.hoveredPoint === null) this.hoveredTimestamp = null;
  }

  itemForTimestamp(timestamp) {
    if (timestamp === null) return null;
    const items = CANDLE_MODES.has(this.mode) ? this.geometry.candles : this.geometry.points;
    return items.find((item) => item.timestamp === timestamp) ?? null;
  }

  onMouseMove(event, cx) {
    const width = event.bounds.width;
    if (!(width > 0)) return;
    const point = CANDLE_MODES.has(this.mode)
      ? this.geometry.candles[
          Math.min(
            this.geometry.candles.length - 1,
            Math.max(
              0,
              Math.floor((event.local_position.x / width) * this.geometry.candles.length),
            ),
          )
        ]
      : findNearestPricePoint(
          this.geometry,
          (event.local_position.x / width) * this.geometry.width,
        );
    if (!point || this.hoveredTimestamp === point.timestamp) return;
    this.hoveredTimestamp = point.timestamp;
    this.hoveredPoint = point;
    cx.notify();
  }

  onHover(hovered, cx) {
    if (hovered || this.hoveredPoint === null) return;
    this.hoveredTimestamp = null;
    this.hoveredPoint = null;
    cx.notify();
  }

  chartFrame(tokens, geometry) {
    return v_flex()
      .id(`price-chart-${this.mode}`)
      .h(178)
      .gap(tokens.spacing.xs)
      .child(
        h_flex()
          .w_full()
          .items_baseline()
          .justify_between()
          .child(
            label(tokens, chartTitle(this.mode), TYPE.body)
              .font_weight(700)
              .text_color(tokens.muted_foreground),
          )
          .when(geometry.min !== null, (element) =>
            element.child(
              numeric(
                tokens,
                `${geometry.min.toFixed(2)} — ${geometry.max.toFixed(2)}`,
                TYPE.bodySmall,
              ),
            ),
          ),
      );
  }

  stateFrame(tokens, chart, geometry) {
    const height = this.layout.height;
    if (this.state === "loading") {
      return chart.child(
        v_flex()
          .h(height)
          .justify_center()
          .gap(tokens.spacing.sm)
          .child(muted(tokens, `Loading ${chartTitle(this.mode)}…`))
          .child(
            Progress.new(`price-chart-loading-${this.mode}`)
              .indeterminate(true)
              .w_full()
              .h(2)
              .flex()
              .items_center()
              .child(
                ProgressTrack.new()
                  .w_full()
                  .h(2)
                  .bg(tokens.muted)
                  .child(ProgressIndicator.new().w("42%").h_full().bg(tokens.muted_foreground)),
              ),
          ),
      );
    }
    const count = CANDLE_MODES.has(this.mode) ? geometry.candles.length : geometry.points.length;
    if (this.state === "error" || count === 0) {
      const failed = this.state === "error";
      return chart.child(
        v_flex()
          .h(height)
          .items_center()
          .justify_center()
          .gap(tokens.spacing.xs)
          .child(
            label(
              tokens,
              failed ? `${chartTitle(this.mode)} did not load` : `No ${chartTitle(this.mode)} data`,
              TYPE.body,
            ),
          )
          .child(
            muted(
              tokens,
              failed
                ? "Choose another chart mode or date, then try again."
                : "Choose another chart mode or date.",
            ),
          ),
      );
    }
    return null;
  }

  lineTooltip(tokens, point, geometry, date, time, tone, session = "") {
    return v_flex()
      .absolute()
      .top(4)
      .when(point.x > geometry.width * 0.68, (tip) => tip.left(4))
      .when(point.x <= geometry.width * 0.68, (tip) => tip.right(4))
      .px(tokens.spacing.sm)
      .py(tokens.spacing.xs)
      .gap(tokens.spacing.xxs)
      .rounded(tokens.radius.md)
      .border(1)
      .border_color(tokens.border)
      .bg(tokens.surface)
      .transition("opacity", { duration: 150, easing: "ease-out" })
      .child(numeric(tokens, point.close.toFixed(3), TYPE.body).text_color(tone))
      .child(muted(tokens, `${date} ${time}`))
      .when(Boolean(session), (element) => element.child(muted(tokens, `Session ${session}`)));
  }

  renderFiveDay(tokens, chart, geometry) {
    const height = this.layout.height;
    const tone = valueTone(tokens, priceWindowChange(geometry));
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
      Background.stop(tone, 0),
      Background.stop(tokens.surface, 1),
    ).opacity(0.32);
    const point = this.hoveredPoint;
    const hoverX = point ? percentage(point.x, geometry.width) : null;
    const indicator = point
      ? PathBuilder.stroke(1).move_to(hoverX, 0).line_to(hoverX, "100%").dash_array([3, 3]).build()
      : null;
    const marker = point ? markerBlock(point, geometry) : null;
    const time = point ? formatMarketTime(this.symbol, point.timestamp) : "";
    const date = typeof point?.date === "string" ? point.date : "";
    return chart
      .child(
        div()
          .id("five-day-plot")
          .relative()
          .h(height)
          .w_full()
          .on_mouse_move((event, cx) => this.onMouseMove(event, cx))
          .on_hover((hovered, cx) => this.onHover(hovered, cx))
          .child(window.paint_path(fill, area).absolute().inset_0())
          .child(window.paint_path(stroke, tone).absolute().inset_0())
          .when(indicator, (element) =>
            element
              .child(window.paint_path(indicator, tokens.muted_foreground).absolute().inset_0())
              .child(window.paint_path(marker, tone).absolute().inset_0())
              .child(this.lineTooltip(tokens, point, geometry, date, time, tone)),
          ),
      )
      .child(
        h_flex()
          .id("five-day-time-axis")
          .w_full()
          .h(16)
          .items_center()
          .justify_between()
          .border_t(1)
          .border_color(tokens.border)
          .children(geometry.days.map((day) => muted(tokens, day.date.slice(5)))),
      );
  }

  renderIntraday(tokens, chart, geometry) {
    const height = this.layout.height;
    const point = this.hoveredPoint;
    const hoverX = point ? percentage(point.x, geometry.width) : null;
    const indicator = point
      ? PathBuilder.stroke(1).move_to(hoverX, 0).line_to(hoverX, "100%").dash_array([3, 3]).build()
      : null;
    const marker = point ? markerBlock(point, geometry) : null;
    const previous = geometry.previousClose;
    const previousLine = previous
      ? PathBuilder.stroke(1)
          .move_to("0%", percentage(previous.y, height))
          .line_to("100%", percentage(previous.y, height))
          .dash_array([3, 3])
          .build()
      : null;
    const current = geometry.points.at(-1);
    const currentMarker = current ? markerBlock(current, geometry) : null;
    const date = point ? candleDate(this.symbol, point) : "";
    const time = point ? formatMarketTime(this.symbol, point.timestamp) : "";
    return chart
      .child(
        div()
          .id("intraday-plot")
          .relative()
          .h(height)
          .w_full()
          .on_mouse_move((event, cx) => this.onMouseMove(event, cx))
          .on_hover((hovered, cx) => this.onHover(hovered, cx))
          .when(previousLine, (element) =>
            element
              .child(window.paint_path(previousLine, tokens.muted_foreground).absolute().inset_0())
              .child(
                muted(tokens, `Previous close ${formatValue(previous.price)}`)
                  .absolute()
                  .right(2)
                  .bottom(2)
                  .bg(tokens.background),
              ),
          )
          .when(currentMarker, (element) =>
            element.child(
              div()
                .id("intraday-current-marker")
                .absolute()
                .inset_0()
                .child(
                  window
                    .paint_path(currentMarker, sessionTone(tokens, current.tradeSession))
                    .absolute()
                    .inset_0(),
                ),
            ),
          )
          .children(
            geometry.sessionSegments.map((segment) => {
              const points = segment.points.map((item) => [
                percentage(item.x, geometry.width),
                percentage(item.y, geometry.height),
              ]);
              return window
                .paint_path(
                  PathBuilder.stroke(1.5).add_polygon(points, false).build(),
                  sessionTone(tokens, segment.tradeSession),
                )
                .opacity(sessionOpacity(segment.tradeSession))
                .absolute()
                .inset_0();
            }),
          )
          .children(
            geometry.sessionBoundaries.slice(1).map((boundary) =>
              window
                .paint_path(
                  PathBuilder.stroke(1)
                    .move_to(percentage(boundary.x, geometry.width), 0)
                    .line_to(percentage(boundary.x, geometry.width), "100%")
                    .dash_array([2, 3])
                    .build(),
                  tokens.border,
                )
                .absolute()
                .inset_0(),
            ),
          )
          .when(indicator, (element) =>
            element
              .child(window.paint_path(indicator, tokens.muted_foreground).absolute().inset_0())
              .when(point.timestamp !== current?.timestamp, (hover) =>
                hover.child(
                  window
                    .paint_path(marker, sessionTone(tokens, point.tradeSession))
                    .absolute()
                    .inset_0(),
                ),
              )
              .child(
                this.lineTooltip(
                  tokens,
                  point,
                  geometry,
                  date,
                  time,
                  sessionTone(tokens, point.tradeSession),
                  SESSION_LABELS[point.tradeSession] ?? "Session",
                ),
              ),
          ),
      )
      .child(
        h_flex()
          .id("intraday-time-axis")
          .w_full()
          .h(16)
          .items_center()
          .justify_between()
          .border_t(1)
          .border_color(tokens.border)
          .children(
            geometry.sessionBoundaries.map((boundary) =>
              label(
                tokens,
                SESSION_LABELS[boundary.tradeSession] ?? "Session",
                TYPE.bodySmall,
              ).text_color(sessionTone(tokens, boundary.tradeSession)),
            ),
          ),
      );
  }

  renderCandles(tokens, chart, geometry) {
    const height = this.layout.height;
    const candle = this.hoveredPoint;
    const x = candle ? `${candle.wick.x.toFixed(3)}%` : null;
    const indicator = x
      ? PathBuilder.stroke(1).move_to(x, 0).line_to(x, "100%").dash_array([3, 3]).build()
      : null;
    const time = candle ? formatMarketTime(this.symbol, candle.timestamp) : "";
    const day = candle ? candleDate(this.symbol, candle) : "";
    const ticks = candleAxisTicks(geometry.candles);
    return chart
      .child(
        div()
          .id("price-chart-candles")
          .relative()
          .h(height)
          .w_full()
          .on_mouse_move((event, cx) => this.onMouseMove(event, cx))
          .on_hover((hovered, cx) => this.onHover(hovered, cx))
          .children(
            geometry.candles.flatMap((item) => {
              const tone = valueTone(tokens, candleDirection(item));
              return [
                window.paint_path(candleWickPath(item), tone).absolute().inset_0(),
                window.paint_path(candleBodyPath(item), tone).absolute().inset_0(),
              ];
            }),
          )
          .when(indicator, (element) =>
            element
              .child(window.paint_path(indicator, tokens.muted_foreground).absolute().inset_0())
              .child(this.candleTooltip(tokens, candle, day, time)),
          ),
      )
      .child(
        v_flex()
          .id("candlestick-time-axis")
          .relative()
          .w_full()
          .h(16)
          .border_t(1)
          .border_color(tokens.border)
          .children(ticks.map((item) => candleAxisTick(tokens, this.symbol, this.mode, item))),
      );
  }

  candleTooltip(tokens, candle, day, time) {
    return v_flex()
      .absolute()
      .top(4)
      .when(candle.wick.x > 50, (tip) => tip.left(4))
      .when(candle.wick.x <= 50, (tip) => tip.right(4))
      .px(tokens.spacing.sm)
      .py(tokens.spacing.xs)
      .gap(tokens.spacing.xxs)
      .rounded(tokens.radius.md)
      .border(1)
      .border_color(tokens.border)
      .bg(tokens.surface)
      .child(label(tokens, `${day} ${time}`, TYPE.bodySmall))
      .child(
        numeric(
          tokens,
          `O ${formatValue(candle.open)}  H ${formatValue(candle.high)}`,
          TYPE.bodySmall,
        ),
      )
      .child(
        numeric(
          tokens,
          `L ${formatValue(candle.low)}  C ${formatValue(candle.close)}`,
          TYPE.bodySmall,
        ),
      )
      .child(muted(tokens, `Volume ${formatValue(candle.volume)}`));
  }

  render(cx) {
    const tokens = cx.theme();
    const geometry = this.geometry;
    const chart = this.chartFrame(tokens, geometry);
    const state = this.stateFrame(tokens, chart, geometry);
    if (state) return state;
    if (this.mode === "intraday") return this.renderIntraday(tokens, chart, geometry);
    if (CANDLE_MODES.has(this.mode)) return this.renderCandles(tokens, chart, geometry);
    return this.renderFiveDay(tokens, chart, geometry);
  }
}
