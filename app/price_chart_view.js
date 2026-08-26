import {
  Background,
  PathBuilder,
  Progress,
  ProgressIndicator,
  ProgressTrack,
  View,
  div,
  h_flex,
  paint_path,
  v_flex,
} from "gpui";

import { findNearestPricePoint, formatMarketTime, layoutPriceSeries } from "./chart.js";
import { label, muted, numeric } from "./ui.js";

export const PRICE_CHART_LAYOUT = Object.freeze({ width: 480, height: 132, dayGap: 8 });

/** @param {number} value @param {number} total @returns {`${number}%`} */
function percentage(value, total) {
  return /** @type {`${number}%`} */ (`${total > 0 ? (value / total) * 100 : 0}%`);
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
          .child(label(tokens, "5D intraday"))
          .when(geometry.min !== null, (element) =>
            element.child(
              numeric(tokens, `${geometry.min.toFixed(2)} — ${geometry.max.toFixed(2)}`, 11),
            ),
          ),
      );

    if (this.state === "loading") {
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
    if (this.state === "error" || geometry.points.length === 0) {
      return chart.child(
        v_flex()
          .h(height)
          .items_center()
          .justify_center()
          .child(muted(tokens, this.state === "error" ? "Chart unavailable" : "No 5D data")),
      );
    }

    /** @type {Array<[import("gpui").PathCoordinate, import("gpui").PathCoordinate]>} */
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
      ? PathBuilder.stroke(1).move_to(hoverX, 0).line_to(hoverX, "100%").dash_array([3, 3]).build()
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
                  .child(muted(tokens, `${hoverDate} ${hoverTime}`)),
              ),
          ),
      )
      .child(
        h_flex()
          .justify_between()
          .children(geometry.days.map((day) => muted(tokens, day.date.slice(5)))),
      );
  }
}
