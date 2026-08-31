// The order ticket, in both of its stages, and the menus that open it.
//
// What is under test is what a reader sees before any money moves: that the
// form states its fields, that the confirmation restates the order rather
// than offering it again for editing, and that buying and selling are told
// apart by colour wherever either is offered.

import { v_flex } from "gpui-base";
import LongbridgeApp from "./main.js";
import { normalizeOrders } from "./orders.js";

const WORKING_ORDER = Object.freeze({
  order_id: "884955210001",
  status: "NewStatus",
  stock_name: "Apple Inc.",
  quantity: "10",
  executed_quantity: "0",
  price: "180.000",
  submitted_at: "1700000900",
  side: "Buy",
  symbol: "AAPL.US",
  order_type: "LO",
  currency: "USD",
  time_in_force: "Day",
});

export default class TradeUiProbe extends LongbridgeApp {
  init(_props, _cx) {
    this.initInteractionState();
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
    this.holdings = [
      { symbol: "AAPL.US", name: "Apple Inc.", quantity: "40", available: "25", currency: "USD" },
    ];
    this.page = "watchlist";
    this.selectedSymbol = "AAPL.US";
    this.hasStoredTokens = true;
    this.status = { state: "connected" };
    this.error = "";
    this.streamError = "";
    this.clock = null;
    this.ordersState = {
      status: "ready",
      today: normalizeOrders({ data: { orders: [WORKING_ORDER] } }),
      history: [],
      error: "",
    };
    this.selectedOrderRowId = "884955210001";
    // A board lot the socket has already answered for, so the ticket can be
    // drawn with one without the probe reaching a socket at all.
    this.lotSizes = new Map([["700.HK", 100]]);
  }

  /** The probe reaches no network: what is under test is what it draws. */
  loadOrders() {}

  /** A dialog is the shell's own surface; the probe draws its body inline. */
  presentTicket() {}

  /**
   * `window.refresh()` is a host call, and a host call from inside `render` is
   * not legal -- the probe drives the ticket through its stages during the
   * pass that draws them, so the redraw it would ask for is the pass it is
   * already in.
   */
  refreshTicket() {}

  render(cx) {
    const tokens = cx.theme();

    // A ticket on the sell side, filled in, so the form draws its fields and
    // the position it may not exceed.
    this.ticket = {
      ...this.blankTicket(),
      open: true,
      side: "Sell",
      symbol: "AAPL.US",
      name: "Apple Inc.",
      currency: "USD",
    };
    this.ticketPrice.set_value("188.5");
    this.ticketQuantity.set_value("10");
    const form = this.ticketDialog(tokens);

    // The same ticket, confirmed: what Review froze, restated.
    this.reviewTicket(cx);
    const review = this.ticketDialog(tokens);

    // A market order states that it has no price and no estimate rather than
    // showing an empty field or a zero.
    this.ticket = { ...this.ticket, stage: "form", type: "MO" };
    this.ticketQuantity.set_value("10");
    this.reviewTicket(cx);
    const marketReview = this.ticketDialog(tokens);

    // A quantity above the position is refused before anything is sent.
    this.ticket = { ...this.ticket, stage: "form", type: "LO" };
    this.ticketQuantity.set_value("999");
    this.reviewTicket(cx);
    const refused = this.ticketDialog(tokens);

    // Hong Kong trades in board lots: the form states the lot, and a part lot
    // is refused before anything is sent.
    this.ticket = {
      ...this.blankTicket(),
      open: true,
      side: "Buy",
      symbol: "700.HK",
      name: "Tencent",
      currency: "HKD",
      lotSize: 100,
    };
    this.ticketPrice.set_value("320");
    this.ticketQuantity.set_value("100");
    const lotForm = this.ticketDialog(tokens);
    this.ticketQuantity.set_value("150");
    this.reviewTicket(cx);
    const partLot = this.ticketDialog(tokens);

    // Withdrawing opens straight into its confirmation: nothing to fill in.
    this.ticket = {
      ...this.blankTicket(),
      open: true,
      stage: "review",
      mode: "cancel",
      side: "Buy",
      symbol: "AAPL.US",
      name: "Apple Inc.",
      orderId: "884955210001",
    };
    const withdraw = this.ticketDialog(tokens);

    // The three menus, each offering what its list can act on.
    this.ticket = this.blankTicket();
    this.rowMenu = { symbol: "AAPL.US", x: 0, y: 0, source: "watchlist" };
    const watchlistMenu = this.rowMenuSurface(tokens);
    this.rowMenu = { symbol: "AAPL.US", x: 0, y: 0, source: "holdings" };
    const holdingsMenu = this.rowMenuSurface(tokens);
    this.rowMenu = {
      symbol: "AAPL.US",
      x: 0,
      y: 0,
      source: "orders",
      orderId: "884955210001",
    };
    const ordersMenu = this.rowMenuSurface(tokens);
    this.rowMenu = null;

    return v_flex()
      .size_full()
      .child(form)
      .child(review)
      .child(marketReview)
      .child(refused)
      .child(lotForm)
      .child(partLot)
      .child(withdraw)
      .child(this.tradeActions(tokens, "AAPL.US"))
      .child(watchlistMenu)
      .child(holdingsMenu)
      .child(ordersMenu);
  }
}
