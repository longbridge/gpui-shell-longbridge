// The two workspace panes, as dock panels.
//
// A panel is a view a dock happens to be holding, and these two hold nothing of
// their own: the market data, the selection and the filters all still live on
// the application, and each panel draws the method that already drew that pane.
// What they add is a redraw boundary. A dock panel is not a child of the
// application's description — the dock area holds it — so it repaints only when
// something tells it to, which is what `set_props` is for.
//
// `update(props)` is empty on purpose. The props carry a revision the
// application bumps whenever the data these draw has changed; the value is never
// read, because the point of the call is the refresh it causes, not what it
// delivers. Writing it out is what makes that legible.

import { View } from "gpui";

/** @import { Context } from "gpui" */

/** The half a panel shares: who owns the data it draws. */
class WorkspacePanel extends View {
  /** @param {{ app: any }} props */
  init(props) {
    this.app = props.app;
  }

  /** @param {{ app?: any }} props */
  update(props) {
    if (props?.app) this.app = props.app;
  }
}

/** The watchlist, with its filter and its virtualized table. */
export class WatchlistPanel extends WorkspacePanel {
  /** @param {Context} cx */
  render(cx) {
    return this.app.watchlist(cx.theme()).size_full();
  }
}

/** The selected instrument: quote, statistics and the retained price chart. */
export class DetailPanel extends WorkspacePanel {
  /** @param {Context} cx */
  render(cx) {
    return this.app.stockDetail(cx.theme()).size_full();
  }
}
