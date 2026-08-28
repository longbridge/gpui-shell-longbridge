// Dock geometry is app-owned because DockArea.load() constructs replacement
// panel entities. These vectors keep the saved-name -> live-handle bridge
// honest while exercising the same dump reduction used by the running app.

import { View } from "gpui";
import { detailTilesFromDockDump, normalizeDetailTiles } from "./main.js";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const rearrangedDump = {
  right_dock: {
    panel: {
      panel_name: "Tiles",
      children: [
        { panel_name: "shell:longbridge/market-detail", children: [], info: { panel: {} } },
        { panel_name: "shell:longbridge/quote-details", children: [], info: { panel: {} } },
        { panel_name: "shell:longbridge/chart", children: [], info: { panel: {} } },
      ],
      info: {
        tiles: {
          metas: [
            { bounds: { origin: { x: 12, y: 8 }, size: { width: 430, height: 260 } }, z_index: 0 },
            { bounds: { origin: { x: 6, y: 274 }, size: { width: 430, height: 180 } }, z_index: 1 },
            {
              bounds: { origin: { x: 22, y: 460 }, size: { width: 390, height: 310 } },
              z_index: 2,
            },
          ],
        },
      },
    },
  },
};

export default class WorkspaceLayoutProbe extends View {
  init() {
    const saved = detailTilesFromDockDump(rearrangedDump, []);
    check(
      saved.map((tile) => tile.name).join(",") === "market-detail,quote-details,chart",
      "dump traversal must keep a rearranged tile z order",
    );
    check(
      saved[0].x === 12 && saved[0].height === 260 && saved[2].width === 390 && saved[2].y === 460,
      "dump reduction must retain resized tile geometry",
    );

    // The storage boundary is JSON, and startup reconnects each saved name to
    // entities made in this live app — not to entities constructed by load().
    const restored = normalizeDetailTiles(JSON.parse(JSON.stringify(saved)));
    const liveHandles = new Map([
      ["quote-details", { live: "quote" }],
      ["chart", { live: "retained-chart" }],
      ["market-detail", { live: "market" }],
    ]);
    const rehydrated = restored.map((tile) => ({ tile, handle: liveHandles.get(tile.name) }));
    check(
      rehydrated.every(({ handle }) => handle) && rehydrated[2].handle.live === "retained-chart",
      "restored names must target the app's live quote/chart/market handles",
    );
    check(
      rehydrated[0].tile.name === "market-detail" && rehydrated[0].tile.width === 430,
      "round trip must preserve tile order and geometry while targeting its live handle",
    );
  }

  render() {
    return "ok";
  }
}
