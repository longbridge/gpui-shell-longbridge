// The Orders page: today's orders over the account's history, both drawn from
// one normalized read, with the states a read can be in written where the rows
// would be.

import { Table, v_flex } from "gpui-base";
import LongbridgeApp from "./main.js";
import { normalizeOrders } from "./orders.js";
import { orderRow, ordersHeader } from "./ui.js";

const TODAY = Object.freeze([
  {
    order_id: "884955210000",
    status: "FilledStatus",
    stock_name: "Apple Inc.",
    quantity: "10",
    executed_quantity: "10",
    price: "188.500",
    executed_price: "188.480",
    submitted_at: "1700000000",
    updated_at: "1700000030",
    side: "Buy",
    symbol: "AAPL.US",
    order_type: "LO",
    currency: "USD",
    time_in_force: "Day",
    last_done: "188.900",
    remark: "desk ticket",
  },
  {
    order_id: "884955210001",
    status: "NewStatus",
    stock_name: "Tesla",
    quantity: "5",
    executed_quantity: "0",
    price: "",
    executed_price: "",
    submitted_at: "1700000900",
    side: "Sell",
    symbol: "TSLA.US",
    order_type: "MO",
    currency: "USD",
    msg: "Working at the exchange",
  },
]);

const HISTORY = Object.freeze([
  {
    order_id: "884955209000",
    status: "RejectedStatus",
    stock_name: "Tencent",
    quantity: "200",
    executed_quantity: "0",
    price: "320.000",
    executed_price: "",
    submitted_at: "1699000000",
    side: "Buy",
    symbol: "700.HK",
    order_type: "ELO",
    currency: "HKD",
    msg: "Insufficient buying power",
  },
  {
    order_id: "884955209001",
    status: "CanceledStatus",
    stock_name: "NVIDIA",
    quantity: "3",
    executed_quantity: "1",
    price: "120.000",
    executed_price: "119.900",
    submitted_at: "1698000000",
    side: "Sell",
    symbol: "NVDA.US",
    order_type: "LO",
    currency: "USD",
  },
]);

export default class OrdersUiProbe extends LongbridgeApp {
  init(_props, _cx) {
    // A probe replaces init wholesale, so it owes the view the state a render
    // reaches for unconditionally.
    this.initInteractionState();
    this.initOrdersState();
    // The instrument the open sheet names is in the Watchlist, so the sheet
    // offers the way through to its quote.
    this.quotes = [
      { symbol: "AAPL.US", code: "AAPL", name: "Apple Inc.", market: "US", currency: "USD" },
    ];
    this.instruments = [];
    this.page = "orders";
    this.hasStoredTokens = true;
    this.status = { state: "connected" };
    this.error = "";
    this.streamError = "";
    this.clock = null;
    this.ordersState = {
      status: "ready",
      today: normalizeOrders({ data: { orders: TODAY } }),
      history: normalizeOrders({ data: { orders: HISTORY } }),
      error: "",
    };
    // One order open, because the sheet beside the lists is half of what this
    // page is: a click on a row is answered on the right.
    this.selectedOrderId = "884955210000";
  }

  /** The probe reaches no network: what is under test is what it draws. */
  loadOrders() {}

  render(cx) {
    const tokens = cx.theme();
    const rows = [...this.ordersState.today, ...this.ordersState.history];
    return (
      v_flex()
        .size_full()
        .child(this.ordersPage(tokens).flex_1().min_h(0))
        // A virtual list describes itself and its item count; its rows are
        // built during layout and never reach the description. So the probe
        // also draws the same rows directly, in the table parts they belong
        // to, which is where what one row draws can be read.
        .child(
          Table.new("probe-orders")
            .row_count(rows.length + 1)
            .column_count(6)
            .flex()
            .flex_col()
            .child(ordersHeader(tokens, "probe-orders"))
            .children(rows.map((order, index) => orderRow(tokens, order, index))),
        )
    );
  }
}
