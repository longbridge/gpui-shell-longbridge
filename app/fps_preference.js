const FPS_VISIBLE_KEY = "workspace.fps-visible.v1";

export function loadFpsVisible() {
  return localStorage.getItem(FPS_VISIBLE_KEY) === "true";
}

/** @param {boolean} visible */
export async function saveFpsVisible(visible) {
  localStorage.setItem(FPS_VISIBLE_KEY, visible ? "true" : "false");
  await localStorage.flush();
}
