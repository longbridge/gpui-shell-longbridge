import { Background, PathBuilder, View, div } from "gpui";
import { Progress, ProgressIndicator, ProgressTrack, h_flex, v_flex } from "gpui-base";
import {
  findNearestPricePoint,
  formatMarketTime,
  layoutPriceSeries,
  priceWindowChange,
} from "./chart.js";
import { valueTone } from "./palette.js";
import { label, muted, numeric } from "./ui.js";

export const PRICE_CHART_LAYOUT = Object.freeze({ width: 480, height: 132, dayGap: 8 });

// The product type scale, restricted to the steps this chart uses. `muted()`
// already carries `body-small`; these are the sizes the chart passes itself, so
// that no tick, tooltip or heading here can drift off the scale.
const TYPE = Object.freeze({ bodySmall: 11, body: 12 });

// The hover mark is a filled block, not a dot: square geometry is the
// terminal-native mark, and a 6 px square is legible without covering the
// candle it sits on.
const MARKER_SIZE = 6;

/** @param {number} value @param {number} total @returns {`${number}%`} */
function percentage(value, total) {
  return /** @type {`${number}%`} */ (`${total > 0 ? (value / total) * 100 : 0}%`);
}

/** @param {number} value @returns {`${number}%`} */
function clampPercentage(value) {
  return /** @type {`${number}%`} */ (`${Math.min(100, Math.max(0, value))}%`);
}

/**
 * The hover marker: a filled square centred on the hovered candle, clamped to
 * the plot so an edge candle keeps its mark rather than drawing outside.
 *
 * @param {PriceChartLaidOutPoint} point
 * @param {PriceChartGeometry} geometry
 */
function markerBlock(point, geometry) {
  const halfX = geometry.width > 0 ? (MARKER_SIZE / 2 / geometry.width) * 100 : 0;
  const halfY = geometry.height > 0 ? (MARKER_SIZE / 2 / geometry.height) * 100 : 0;
  const centerX = geometry.width > 0 ? (point.x / geometry.width) * 100 : 0;
  const centerY = geometry.height > 0 ? (point.y / geometry.height) * 100 : 0;
  const left = clampPercentage(centerX - halfX);
  const right = clampPercentage(centerX + halfX);
  const top = clampPercentage(centerY - halfY);
  const bottom = clampPercentage(centerY + halfY);
  return PathBuilder.fill()
    .move_to(left, top)
    .line_to(right, top)
    .line_to(right, bottom)
    .line_to(left, bottom)
    .close()
    .build();
}

/** The retained invalidation boundary for price-chart geometry and hover interaction. */
export default class PriceChartView extends View {
  /** @param {PriceChartProps} props */
  init(props) {
    this.hoveredTimestamp = null;
    this.applyProps(props);
  }

  /** @param {PriceChartProps} props */
  update(props) {
    this.applyProps(props);
  }

  /** @param {PriceChartProps} props */
  applyProps(props) {
    const previousSymbol = this.symbol;
    const previousSeries = this.series;
    const previousLayout = this.layout;

    this.symbol = props.symbol;
    this.series = props.series;
    this.state = props.state;
    this.layout = props.layout;
    this.themeRevision = props.themeRevision;

    if (
      previousSeries !== this.series ||
      previousLayout?.width !== this.layout.width ||
      previousLayout?.height !== this.layout.height ||
      previousLayout?.dayGap !== this.layout.dayGap
    ) {
      this.geometry = /** @type {PriceChartGeometry} */ (
        layoutPriceSeries(this.series, this.layout)
      );
    }

    if (previousSymbol !== this.symbol) this.hoveredTimestamp = null;
    this.hoveredPoint =
      this.hoveredTimestamp === null
        ? null
        : (this.geometry.points.find((point) => point.timestamp === this.hoveredTimestamp) ?? null);
    if (this.hoveredPoint === null) this.hoveredTimestamp = null;
  }

  /**
   * @param {import("gpui").MouseMoveEvent} event
   * @param {import("gpui").Context} cx
   */
  onMouseMove(event, cx) {
    const width = event.bounds.width;
    if (!(width > 0)) return;
    const point = findNearestPricePoint(
      this.geometry,
      (event.local_position.x / width) * this.geometry.width,
    );
    if (!point || this.hoveredTimestamp === point.timestamp) return;
    this.hoveredTimestamp = point.timestamp;
    this.hoveredPoint = point;
    cx.notify();
  }

  /** @param {boolean} hovered @param {import("gpui").Context} cx */
  onHover(hovered, cx) {
    if (hovered || this.hoveredPoint === null) return;
    this.hoveredTimestamp = null;
    this.hoveredPoint = null;
    cx.notify();
  }

  /** @param {import("gpui").Context} cx */
  render(cx) {
    const tokens = cx.theme();
    const geometry = this.geometry;
    const hoveredPoint = this.hoveredPoint;
    const height = this.layout.height;
    const chart = v_flex()
      .id("five-day-chart")
      .h(178)
      .gap(tokens.spacing.xs)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          // A section heading: small, bold and muted, with the value beside it
          // carrying the foreground.
          .child(
            label(tokens, "5D intraday", TYPE.body)
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

    if (this.state === "loading") {
      // A one-line terminal progress indicator on the plot's own baseline, not
      // a spinner: it occupies the height the plot will occupy, so nothing
      // moves when the candles arrive. The track is the raised well and the
      // indicator its own foreground -- loading is not an accent-worthy event.
      return chart.child(
        v_flex()
          .h(height)
          .justify_center()
          .gap(tokens.spacing.sm)
          .child(muted(tokens, "Loading 5D intraday…"))
          .child(
            Progress.new("five-day-loading")
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
    if (this.state === "error" || geometry.points.length === 0) {
      // Both states name the object and the way back: a failed request has a
      // reload behind it, an empty window has the date picker.
      const failed = this.state === "error";
      const heading = failed ? "5D history did not load" : "No intraday candles here";
      const detail = failed
        ? "The candlestick request failed. Reload the 5D chart from the menu."
        : "Five regular trading days plot here. Pick another end date.";
      return chart.child(
        v_flex()
          .h(height)
          .items_center()
          .justify_center()
          .gap(tokens.spacing.xs)
          .child(label(tokens, heading, TYPE.body))
          .child(muted(tokens, detail)),
      );
    }

    // The series is toned by its own five-day direction, which is the threshold
    // this plot is about. `primary` is the interactive accent and stays on the
    // controls: a price line and a button must not share a colour.
    const tone = valueTone(tokens, priceWindowChange(geometry));
    /** @type {Array<[import("gpui-shell").PathCoordinate, import("gpui-shell").PathCoordinate]>} */
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
    const hoverX = hoveredPoint ? percentage(hoveredPoint.x, geometry.width) : null;
    const indicator = hoveredPoint
      ? PathBuilder.stroke(1).move_to(hoverX, 0).line_to(hoverX, "100%").dash_array([3, 3]).build()
      : null;
    const marker = hoveredPoint ? markerBlock(hoveredPoint, geometry) : null;
    const hoverTime = hoveredPoint ? formatMarketTime(this.symbol, hoveredPoint.timestamp) : "";
    const hoverDate = typeof hoveredPoint?.date === "string" ? hoveredPoint.date : "";

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
              .child(
                v_flex()
                  .absolute()
                  .top(4)
                  .when(hoveredPoint.x > geometry.width * 0.68, (tip) => tip.left(4))
                  .when(hoveredPoint.x <= geometry.width * 0.68, (tip) => tip.right(4))
                  .px(tokens.spacing.sm)
                  .py(tokens.spacing.xs)
                  .gap(tokens.spacing.xxs)
                  .rounded(tokens.radius.md)
                  .border(1)
                  .border_color(tokens.border)
                  .bg(tokens.surface)
                  .transition("opacity", { duration: 150, easing: "ease-out" })
                  .child(numeric(tokens, hoveredPoint.close.toFixed(3), TYPE.body))
                  .child(muted(tokens, `${hoverDate} ${hoverTime}`)),
              ),
          ),
      )
      // The date axis, separated from the plot by a hairline rather than by a
      // box: furniture is drawn in `border`, never in a weight that competes
      // with the series. Drawn here rather than borrowed from `ui.js`'s `rule`
      // so the axis keeps this plot's own box, whatever a shared divider grows.
      .child(div().w_full().h(1).bg(tokens.border))
      .child(
        h_flex()
          .justify_between()
          .children(geometry.days.map((day) => muted(tokens, day.date.slice(5)))),
      );
  }
}
