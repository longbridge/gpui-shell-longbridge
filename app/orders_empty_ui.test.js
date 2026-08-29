// The ordinary day: nothing working, a history to read. Today Orders keeps
// its heading -- the count and the filter live there -- and gives the height
// its rows would have taken back to the list underneath.

import { v_flex } from "gpui-base";
import LongbridgeApp from "./main.js";
import { normalizeOrders } from "./orders.js";

const HISTORY = Object.freeze([
  {
    order_id: "884955209000",
    status: "FilledStatus",
    stock_name: "Apple Inc.",
    quantity: "10",
    executed_quantity: "10",
    price: "188.500",
    executed_price: "188.480",
    submitted_at: "1699000000",
    side: "Buy",
    symbol: "AAPL.US",
    order_type: "LO",
    currency: "USD",
  },
  {
    order_id: "884955209001",
    status: "CanceledStatus",
    stock_name: "NVIDIA",
    quantity: "3",
    executed_quantity: "0",
    price: "120.000",
    executed_price: "",
    submitted_at: "1698000000",
    side: "Sell",
    symbol: "NVDA.US",
    order_type: "LO",
    currency: "USD",
  },
]);

export default class EmptyOrdersUiProbe extends LongbridgeApp {
  init(_props, _cx) {
    this.initInteractionState();
    this.initOrdersState();
    this.quotes = [];
    this.instruments = [];
    this.page = "orders";
    this.hasStoredTokens = true;
    this.status = { state: "connected" };
    this.error = "";
    this.streamError = "";
    this.clock = null;
    this.ordersState = {
      status: "ready",
      today: [],
      history: normalizeOrders({ data: { orders: HISTORY } }),
      error: "",
    };
  }

  /** The probe reaches no network: what is under test is what it draws. */
  loadOrders() {}

  render(cx) {
    const tokens = cx.theme();
    return v_flex().size_full().child(this.ordersPage(tokens));
  }
}
