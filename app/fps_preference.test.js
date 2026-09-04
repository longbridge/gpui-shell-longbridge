import { View } from "gpui-kit";
import { v_flex } from "gpui-base";

import { loadFpsVisible, saveFpsVisible } from "./fps_preference.js";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

export default class FpsPreferenceContract extends View {
  init(_props, cx) {
    this.result = "pending";
    cx.spawn(async (cx) => {
      try {
        check(loadFpsVisible() === false, "FPS defaults to hidden when no preference exists");
        await saveFpsVisible(true);
        check(loadFpsVisible() === true, "the enabled FPS preference is restored");
        await saveFpsVisible(false);
        check(loadFpsVisible() === false, "the disabled FPS preference is restored");
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
