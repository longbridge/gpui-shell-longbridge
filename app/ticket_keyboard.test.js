// Filling in an order ticket without a pointer.
//
// The application is driven from the keyboard -- the ticket is reached by one
// -- so a form that can only be completed by clicking is a form half of this
// application cannot use. What that needs is small and specific: Enter means
// the next stage, every control is a tab stop, and the order they are walked
// in is the order they are read in.

import { v_flex } from "gpui-base";
import LongbridgeApp from "./main.js";

export default class TicketKeyboardProbe extends LongbridgeApp {
  init(_props, cx) {
    this.initInteractionState();
    this.initOrdersState();
    this.ticketFocus = cx.focus_handle();
    this.workspaceFocus = cx.focus_handle();
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
    this.results = [];
    this.sent = 0;
    this.shellDialog = false;
  }

  shellHasDialog() {
    return this.shellDialog;
  }

  presentTicket() {
    this.shellDialog = true;
  }

  refreshTicket() {}

  redraw() {}

  loadLotSize() {}

  /** Sending reaches the network; the probe counts the attempt instead. */
  confirmTicket() {
    this.sent += 1;
  }

  check(condition, message) {
    if (!condition) this.results.push(message);
  }

  render(cx) {
    this.results = [];
    const tokens = cx.theme();

    // Enter from the fields reaches the confirmation, and stops there. It is
    // the keystroke someone presses without looking, and the screen it lands
    // on is the one that says what is about to happen.
    this.shellDialog = false;
    this.ticket = this.blankTicket();
    this.openTicket("AAPL.US", "Buy", cx);
    this.ticketQuantity.set_value("10");
    this.check(this.ticket.stage === "form", "a ticket does not open on its confirmation");
    this.advanceTicket(cx);
    this.check(this.ticket.stage === "review", "Enter in the fields does not reach the review");
    this.check(this.sent === 0, "Enter in the fields sent the order without confirming it");

    // Enter again is the send.
    this.advanceTicket(cx);
    this.check(this.sent === 1, "Enter on the confirmation does not send");

    // A ticket that cannot be reviewed stays where it is: Enter must not walk
    // past a field the reader still has to fix.
    this.shellDialog = false;
    this.ticket = this.blankTicket();
    this.openTicket("AAPL.US", "Buy", cx);
    this.ticketQuantity.set_value("");
    this.advanceTicket(cx);
    this.check(this.ticket.stage === "form", "Enter reviewed a ticket that does not validate");
    this.check(Boolean(this.ticket.errors.quantity), "and said nothing about why");

    // Nothing advances while a send is in flight.
    this.ticket = { ...this.ticket, stage: "review", pending: true };
    const before = this.sent;
    this.advanceTicket(cx);
    this.check(this.sent === before, "Enter sent a second time while the first was in flight");

    // Every control the ticket is filled in with is a tab stop, and they are
    // walked in the order they are read in.
    this.shellDialog = false;
    this.ticket = this.blankTicket();
    this.openTicket("AAPL.US", "Buy", cx);
    const form = this.ticketFormBody(tokens);
    const buttons = this.ticketButtons(tokens);

    return v_flex()
      .id("ticket-keyboard-probe")
      .child(this.results.length === 0 ? "the ticket is fillable from the keyboard" : "FAILED")
      .children(this.results)
      .child(form)
      .child(buttons);
  }
}
