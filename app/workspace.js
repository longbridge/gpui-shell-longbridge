import { View } from "gpui";
import { v_flex } from "gpui-base";
import { PANE_INSET, WATCHLIST_MIN_WIDTH } from "./ui.js";

let heldApp = null;

export function holdWorkspaceApp(app) {
  heldApp = app;
}

function workspaceApp() {
  if (!heldApp) throw new Error("workspace application is not available");
  return heldApp;
}

function panelContent(content, minimumWidth = 0) {
  return v_flex()
    .size_full()
    .min_w(minimumWidth)
    .min_h(0)
    .px(PANE_INSET)
    .pb(PANE_INSET)
    .child(content.flex_1().min_h(0));
}

class WorkspacePanel extends View {
  init(_props, cx) {
    this.revision = -1;
    this.refresh = cx.timer.every(100, (cx) => {
      const revision = this.currentRevision();
      if (revision === this.revision) return;
      this.revision = revision;
      cx.notify();
    });
  }

  currentRevision() {
    return 0;
  }
}

export class WatchlistPanel extends WorkspacePanel {
  currentRevision() {
    return heldApp?.paneRevisions?.watchlist ?? 0;
  }
  render(cx) {
    return panelContent(workspaceApp().watchlist(cx.theme()), WATCHLIST_MIN_WIDTH);
  }
}

export class QuoteDetailsPanel extends WorkspacePanel {
  currentRevision() {
    return heldApp?.paneRevisions?.quote ?? 0;
  }
  render(cx) {
    return panelContent(workspaceApp().quoteDetailsPanel(cx.theme()));
  }
}

export class ChartPanel extends WorkspacePanel {
  currentRevision() {
    return heldApp?.paneRevisions?.chart ?? 0;
  }
  render(cx) {
    return panelContent(workspaceApp().chartDetailsPanel(cx.theme()));
  }
}

export class MarketDetailPanel extends WorkspacePanel {
  currentRevision() {
    return heldApp?.paneRevisions?.market ?? 0;
  }
  render(cx) {
    return panelContent(workspaceApp().marketDetailPanel(cx.theme()));
  }
}
