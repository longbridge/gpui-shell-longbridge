import KeymapUiProbe from "./keymap_ui.test.js";

export default class KeyboardNavigationUiProbe extends KeymapUiProbe {
  init(props, cx) {
    super.init(props, cx);
    this.statusBarVisible = false;
    this.calendarOpen = false;
    this.diagnosticsOpen = false;
    this.selectedSymbol = "MSFT.US";
  }
}
