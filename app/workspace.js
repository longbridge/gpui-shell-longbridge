import { View } from "gpui";

let heldApp = null;

export function holdWorkspaceApp(app) {
  heldApp = app;
}

class WorkspacePanel extends View {
  init(props, cx) {
    this.app = props?.app ?? heldApp;
    this.revision = -1;
    this.refresh = cx.timer.every(50, (cx) => {
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
    return this.app?.paneRevisions?.watchlist ?? 0;
  }
  render(cx) {
    return this.app.watchlist(cx.theme()).size_full();
  }
}

export class QuoteDetailsPanel extends WorkspacePanel {
  currentRevision() {
    return this.app?.paneRevisions?.quote ?? 0;
  }
  render(cx) {
    return this.app.quoteDetailsPanel(cx.theme()).size_full();
  }
}

export class ChartPanel extends WorkspacePanel {
  currentRevision() {
    return this.app?.paneRevisions?.chart ?? 0;
  }
  render(cx) {
    return this.app.chartDetailsPanel(cx.theme()).size_full();
  }
}

export class MarketDetailPanel extends WorkspacePanel {
  currentRevision() {
    return this.app?.paneRevisions?.market ?? 0;
  }
  render(cx) {
    return this.app.marketDetailPanel(cx.theme()).size_full();
  }
}
