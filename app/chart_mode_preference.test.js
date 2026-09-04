import { View } from "gpui-kit";
import { v_flex } from "gpui-base";

import { DEFAULT_CHART_MODE, loadChartMode, saveChartMode } from "./chart_mode_preference.js";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

export default class ChartModePreferenceContract extends View {
  init(_props, cx) {
    this.result = "pending";
    cx.spawn(async (cx) => {
      try {
        check(
          loadChartMode() === DEFAULT_CHART_MODE && DEFAULT_CHART_MODE === "5D",
          "the Chart opens on five sessions until someone chooses otherwise",
        );
        await saveChartMode("15m");
        check(loadChartMode() === "15m", "the chosen interval is restored");
        await saveChartMode("intraday");
        check(loadChartMode() === "intraday", "a later choice replaces the one before it");
        await saveChartMode("30m");
        check(
          loadChartMode() === "intraday",
          "an interval this build does not offer is not written over the one that works",
        );
        localStorage.setItem("workspace.chart-mode.v1", "30m");
        check(
          loadChartMode() === DEFAULT_CHART_MODE,
          "a stored interval this build does not offer falls back to the default",
        );
        this.result = "ok";
      } catch (error) {
        this.result = `failed:${error.message}`;
      }
      cx.notify();
    });
  }

  render() {
    return v_flex().child(this.result);
  }
}
