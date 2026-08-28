// The two workspace panes, as dock panels.
//
// A panel is a view a dock happens to be holding, and these two hold nothing of
// their own: the market data, the selection and the filters all still live on
// the application, and each panel draws the method that already drew that pane.
// What they add is a redraw boundary. A dock panel is not a child of the
// application's description — the dock area holds it — so it repaints only when
// something tells it to, which is what `set_props` is for.
//
// `update(props)` is empty of everything but the application for that reason.
// The props carry a revision the application bumps whenever the data these draw
// has changed; the value is never read, because the point of the call is the
// refresh it causes, not what it delivers.

import { View } from "gpui";

/** @import { Context } from "gpui" */

/**
 * The application these panes draw.
 *
 * It is held here rather than only passed in props, and that is not a
 * convenience — it is the only way a restored pane can draw anything.
 * `DockArea.load` rebuilds a saved layout by constructing the class registered
 * under each panel's name, and it constructs it with no props: an application
 * is a live view, so it was never in the dump to begin with. A pane that took
 * its application only from `props.app` therefore came back from a restart with
 * `undefined` in its place, and rendered nothing at all — the layout was right,
 * the tabs were there, and both panes were blank.
 *
 * So the application hands itself over once, before the dock is built, and a
 * pane falls back to it whenever it was constructed without one. Same shape as
 * `context.js`, and for the same reason: one held reference, set from `init`,
 * with a narrow blast radius and an error rather than a silent `undefined` when
 * it is missing.
 */
let heldApp = null;

/** @param {any} app */
export function holdWorkspaceApp(app) {
  heldApp = app;
}

function workspaceApp() {
  if (!heldApp) {
    throw new Error(
      "no application has been held yet; LongbridgeApp holds one before it builds the dock",
    );
  }
  return heldApp;
}

/** The half a panel shares: who owns the data it draws. */
class WorkspacePanel extends View {
  /** @param {{ app?: any }} [props] */
  init(props) {
    // A panel this application added itself is handed the application; one the
    // dock rebuilt from a saved layout is handed nothing, and takes the held
    // one. Both end up with the same object.
    this.app = props?.app ?? workspaceApp();
  }

  // No `update`: the panel has no changing props. Its application is shared
  // state retained once during init, and the parent repaints it with targeted
  // `cx.notify(entity)` rather than manufacturing a child update transaction.
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
