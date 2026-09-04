import { View } from "gpui-kit";
import {
  historyRange,
  mergeOrder,
  normalizeOrders,
  normalizePushedOrder,
  orderSideLabel,
  orderStatusKind,
  orderStatusLabel,
} from "./orders.js";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function runVectors() {
  check(orderStatusLabel("FilledStatus") === "Filled", "the wire's Status suffix is not a status");
  check(orderStatusLabel("NotReported") === "Not reported", "unsuffixed statuses read the same");
  check(orderStatusLabel("") === "--", "a missing status is not an empty label");
  check(orderStatusLabel("SomethingNew") === "SomethingNew", "an unknown status keeps its name");
  check(orderStatusKind("PartialFilledStatus") === "working", "a partial fill is still working");
  check(orderStatusKind("CanceledStatus") === "ended", "a cancelled order ended without filling");
  check(orderStatusKind("RejectedStatus") === "rejected", "a rejection is its own outcome");
  check(orderStatusKind("Whatever") === "unknown", "an unknown status claims no outcome");
  check(
    orderSideLabel("Buy") === "Buy" && orderSideLabel("SELL") === "Sell",
    "sides read in one case whatever case they arrive in",
  );
  check(orderSideLabel(undefined) === "--", "a missing side is not a buy");

  const orders = normalizeOrders({
    data: {
      has_more: false,
      orders: [
        {
          order_id: "701276261398023",
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
          msg: "",
          remark: "desk",
          time_in_force: "Day",
          last_done: "188.900",
          tag: "Manual",
        },
        {
          order_id: "701276261398024",
          status: "NewStatus",
          stock_name: "Tesla",
          quantity: "5",
          executed_quantity: "0",
          price: "",
          executed_price: "0.000",
          submitted_at: "1700000900",
          side: "Sell",
          symbol: "TSLA.US",
          order_type: "MO",
          currency: "USD",
        },
        "not an order",
      ],
    },
  });

  check(orders.length === 2, "only order records become rows");
  check(
    orders[0].symbol === "TSLA.US" && orders[1].symbol === "AAPL.US",
    "orders are ranked newest first",
  );
  const filled = orders[1];
  check(
    filled.orderId === "701276261398023" &&
      filled.code === "AAPL" &&
      filled.market === "US" &&
      filled.name === "Apple Inc.",
    "an order carries its own identity, not the instrument's alone",
  );
  check(
    filled.statusLabel === "Filled" &&
      filled.statusKind === "filled" &&
      filled.sideLabel === "Buy" &&
      filled.type === "LO",
    "the readable enumerations are resolved once, here",
  );
  check(
    filled.submittedAt === 1_700_000_000_000 && filled.updatedAt === 1_700_000_030_000,
    "unix seconds become milliseconds",
  );
  check(
    filled.timeInForce === "Day" && filled.lastDone === "188.900" && filled.tag === "Manual",
    "the detail sheet's fields survive normalization",
  );
  check(
    filled.triggerPrice === "--" && filled.outsideRth === "",
    "a field the API did not send is absent rather than invented",
  );
  const working = orders[0];
  check(
    working.price === "--" && working.executedPrice === "--",
    "a market order has no price, and zero is not one",
  );
  check(working.updatedAt === 0, "an order that never changed has no update time");
  check(working.executedQuantity === "0", "a zero fill is a quantity and stays one");
  check(Object.isFrozen(orders) && Object.isFrozen(orders[0]), "rows are immutable");
  check(
    normalizeOrders(undefined).length === 0 && normalizeOrders({ data: {} }).length === 0,
    "an unusable payload is an empty list rather than an error",
  );
  check(
    normalizeOrders([{ order_id: "1", symbol: "AAPL.US", submitted_at: "1" }]).length === 1,
    "a bare list of orders is read as one",
  );

  // The push channel describes the same order in different words. What the
  // list calls quantity and price, it calls submitted_quantity and
  // submitted_price -- and a row built from the push has to be the same row.
  const pushed = normalizePushedOrder({
    order_id: "900",
    symbol: "700.HK",
    stock_name: "Tencent",
    side: "Buy",
    status: "NewStatus",
    order_type: "LO",
    submitted_quantity: "200",
    submitted_price: "310.400",
    executed_quantity: "0",
    submitted_at: "1700000000",
    updated_at: "1700000060",
  });
  check(
    pushed.quantity === "200" && pushed.price === "310.400",
    "a pushed order is read into the same row an endpoint's would be",
  );
  check(pushed.statusLabel === "New" && pushed.sideKind === "buy", "and reads the same way");
  check(
    normalizePushedOrder({ order_id: "901", quantity: "5", submitted_quantity: "9" }).quantity ===
      "5",
    "a push that spells it both ways is taken at the endpoint's word",
  );

  // Merging is what a push does to the list it arrives at: replace the row it
  // is about, or take a place in the order the list is already in.
  const listed = normalizeOrders({
    orders: [
      { order_id: "1", symbol: "AAPL.US", submitted_at: "300", status: "NewStatus" },
      { order_id: "2", symbol: "TSLA.US", submitted_at: "100", status: "NewStatus" },
    ],
  });
  const [filledFirst] = normalizeOrders({
    orders: [{ order_id: "1", symbol: "AAPL.US", submitted_at: "300", status: "FilledStatus" }],
  });
  const replaced = mergeOrder(listed, filledFirst);
  check(replaced.length === 2, "an order already in the list does not arrive twice");
  check(replaced[0].statusKind === "filled", "and the list carries its news");
  check(mergeOrder(listed, listed[0]) === listed, "a push that changes nothing changes nothing");
  const [middle] = normalizeOrders({
    orders: [{ order_id: "3", symbol: "MSFT.US", submitted_at: "200", status: "NewStatus" }],
  });
  const inserted = mergeOrder(listed, middle);
  check(
    inserted.map((order) => order.orderId).join(",") === "1,3,2",
    `an order new to the list takes its place by submission time: ${inserted
      .map((order) => order.orderId)
      .join(",")}`,
  );
  check(Object.isFrozen(inserted), "and the list it produces is immutable");

  const range = historyRange(1_700_000_000_000, 2);
  check(
    range.end_at === "1700000000" && range.start_at === String(1_700_000_000 - 2 * 86_400),
    "the history window is whole unix seconds, start before end",
  );
  check(
    Number(historyRange(1_700_000_000_000).start_at) === 1_700_000_000 - 365 * 86_400,
    "the default history window is a year",
  );
}

runVectors();

export default class OrdersVectorProbe extends View {
  render() {
    return { type: "text", text: "ok" };
  }
}
