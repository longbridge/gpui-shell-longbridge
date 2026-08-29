import { CHART_MODES } from "./chart_modes.js";

/**
 * The interval the Chart panel opens on.
 *
 * An interval is a way of reading a market rather than a property of the
 * instrument being read: someone who watches five-minute candles watches them
 * for every symbol, and every session. So it belongs to the workspace and
 * survives a restart, the way the FPS overlay's visibility does.
 */
const CHART_MODE_KEY = "workspace.chart-mode.v1";

/** What the Chart shows before anyone has chosen: five sessions of intraday. */
export const DEFAULT_CHART_MODE = "5D";

/**
 * The stored interval, or the default.
 *
 * A stored value is checked against the modes this build actually has: a
 * preference written by a version that offered an interval this one does not
 * is a name, not a mode, and reading it back unchecked would leave the Chart
 * asking for a period nothing can answer.
 *
 * A store that refuses the read -- a host that granted no storage, which is
 * how the isolated probes run -- is the same answer as one that holds nothing.
 * A remembered interval is a convenience, and a convenience must not be able
 * to take the view down with it.
 */
export function loadChartMode() {
  let stored = null;
  try {
    stored = localStorage.getItem(CHART_MODE_KEY);
  } catch (_) {
    return DEFAULT_CHART_MODE;
  }
  return typeof stored === "string" && CHART_MODES[stored] ? stored : DEFAULT_CHART_MODE;
}

/** @param {string} mode */
export async function saveChartMode(mode) {
  if (!CHART_MODES[mode]) return;
  try {
    localStorage.setItem(CHART_MODE_KEY, mode);
    await localStorage.flush();
  } catch (_) {
    // The interval is already selected and drawn; it simply will not be there
    // next time.
  }
}
