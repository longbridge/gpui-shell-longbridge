import { View, div } from "gpui";
import { v_flex } from "gpui-base";

import WorkspaceUiProbe from "./workspace_ui.test.js";

/**
 * The watchlist without the dock around it.
 *
 * The workspace's panes are dock panels now, and a panel's snapshot belongs to
 * the panel rather than to the view under test — so a probe that had to read a
 * selection back out of the root tree could no longer see it. This one draws
 * the same table directly, which is what the assertion was ever about: a click
 * must travel through the virtual list's own hit box before the selection can
 * change.
 */
export default class WatchlistClickProbe extends WorkspaceUiProbe {
  render(cx) {
    return v_flex()
      .size_full()
      .child(this.watchlist(cx.theme()).size_full())
      .child(div().child(`Selected ${this.selectedSymbol}`));
  }
}

void View;
