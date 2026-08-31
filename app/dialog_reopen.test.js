// Reopening a dialog the shell dismissed by itself.
//
// `open_dialog` takes `escape_dismissable` and `backdrop_dismissable`, and
// `DialogOptions` carries no close callback -- so when a reader presses Escape
// or clicks the backdrop, the surface leaves the window and this side is never
// told. Anything mirroring "is it open?" in a field of its own goes stale
// there, and every `open...` guard reads that field.
//
// The probe answers for the shell rather than driving one: `open_dialog` needs
// a `ShellRoot` as the window's first view, which a test window does not have.
// What is under test is what the application does with the answer.

import { v_flex } from "gpui-base";
import LongbridgeApp from "./main.js";

export default class DialogReopenProbe extends LongbridgeApp {
  init(_props, cx) {
    this.initInteractionState();
    // A probe replaces init wholesale, so it owes the view the state a render
    // reaches for unconditionally -- the ticket surface tracks this handle.
    this.ticketFocus = cx.focus_handle();
    this.initOrdersState();
    this.quotes = [
      {
        symbol: "AAPL.US",
        code: "AAPL",
        name: "Apple Inc.",
        market: "US",
        currency: "USD",
        last: "188.500",
      },
    ];
    this.instruments = [];
    this.holdings = [];
    this.page = "watchlist";
    this.selectedSymbol = "AAPL.US";
    this.hasStoredTokens = true;
    this.status = { state: "connected" };
    this.error = "";
    this.streamError = "";
    this.clock = null;
    this.lotSizes = new Map();
    /** What the probe is answering for the shell's dialog stack. */
    this.shellDialog = false;
    this.results = [];
    this.redraws = 0;
  }

  shellHasDialog() {
    return this.shellDialog;
  }

  /** The shell's own surface; the probe only records that one was asked for. */
  presentTicket() {
    this.shellDialog = true;
  }

  refreshTicket() {}

  /**
   * `cx.notify()` is not legal from inside `render`, and the probe drives the
   * open path during the pass that draws its result. Counting the calls also
   * pins down the thing that made this look like a dropped notify: a click
   * that changes what is on screen has to ask for a redraw even when it
   * declines to open anything.
   */
  redraw() {
    this.redraws += 1;
  }

  /** No socket: a lot lookup would reach one. */
  loadLotSize() {}

  check(condition, message) {
    if (!condition) this.results.push(message);
  }

  render(cx) {
    this.results = [];

    // Opening once works, and the shell is showing it.
    this.shellDialog = false;
    this.ticket = this.blankTicket();
    this.openTicket("AAPL.US", "Buy", cx);
    this.check(this.ticket.open && this.shellDialog, "a first ticket does not open");

    // Escape, or a click on the backdrop: the shell drops the dialog and says
    // nothing, so the flag on this side is now describing a surface that has
    // gone. A row menu is standing, as it would be after a right-click.
    this.shellDialog = false;
    this.rowMenu = { symbol: "AAPL.US", x: 0, y: 0, source: "watchlist" };

    // The second attempt is the whole bug: without reconciling, the guard
    // reads the stale flag, returns, and the ticket can never be opened again.
    this.openTicket("AAPL.US", "Sell", cx);
    this.check(this.ticket.open && this.shellDialog, "a dismissed ticket does not reopen");
    this.check(this.ticket.side === "Sell", "the reopened ticket keeps the first ticket's side");
    this.check(this.rowMenu === null, "the row menu survives the click that was acted on");

    // A dialog that really is open is still only opened once: reconciling must
    // not turn the guard off.
    this.openTicket("AAPL.US", "Buy", cx);
    this.check(this.ticket.side === "Sell", "a second ticket stacks on one already open");

    // A pressed menu item always dismisses its menu, including when the ticket
    // is declined -- a menu left standing reads as a click that did nothing.
    this.rowMenu = { symbol: "AAPL.US", x: 0, y: 0, source: "watchlist" };
    this.redraws = 0;
    this.openTicket("AAPL.US", "Buy", cx);
    this.check(this.rowMenu === null, "a declined ticket leaves its menu on screen");
    this.check(this.redraws > 0, "a declined ticket asks for no redraw, so its menu lingers");

    // The add-a-security dialog is dismissable the same two ways and had the
    // same stale flag; it is reconciled by the same call.
    this.shellDialog = false;
    this.ticket = this.blankTicket();
    this.addSymbolOpen = true;
    this.openTicket("AAPL.US", "Buy", cx);
    this.check(this.ticket.open, "a stale add-symbol flag still blocks the ticket");

    return v_flex()
      .id("dialog-reopen-probe")
      .child(this.results.length === 0 ? "dialogs reopen after the shell dismisses them" : "FAILED")
      .children(this.results);
  }
}
