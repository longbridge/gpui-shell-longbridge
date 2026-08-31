// What a pushed order does to the list on screen.
//
// The gateway reports an order as soon as it exists; this account's own order
// list reports it a moment later. Both are exercised here, in the order they
// actually arrive in, because the failure this guards against is the one where
// the slower of the two wins: the order appears and then vanishes.

import { v_flex } from "gpui-base";
import { normalizeOrders } from "./orders.js";
import LongbridgeApp from "./main.js";

const pushedOrder = (fields) => ({
  order_id: "900",
  symbol: "700.HK",
  stock_name: "Tencent",
  side: "Buy",
  status: "NewStatus",
  order_type: "LO",
  submitted_quantity: "200",
  submitted_price: "310.400",
  submitted_at: "1700000300",
  updated_at: "1700000300",
  ...fields,
});

/** The list as the endpoint answers it, with whatever has reached it so far. */
const listed = (...orders) =>
  normalizeOrders({
    orders: [
      {
        order_id: "1",
        symbol: "AAPL.US",
        status: "NewStatus",
        submitted_at: "1700000100",
        updated_at: "1700000100",
      },
      ...orders,
    ],
  });

export default class OrderPushProbe extends LongbridgeApp {
  init(_props, _cx) {
    this.initOrdersState();
    this.hasStoredTokens = true;
    this.repaints = 0;
    this.results = [];
  }

  redraw() {}

  /** The funnel a push must ask for, counted rather than run. */
  scheduleRedraw() {
    this.repaints += 1;
  }

  check(condition, message) {
    if (!condition) this.results.push(message);
  }

  render() {
    this.results = [];
    this.repaints = 0;
    const cx = null;

    // The push arrives before the page has ever been read. There is no list to
    // merge into, so it is remembered instead -- and the read that follows
    // must not answer with a list that has forgotten it.
    this.initOrdersState();
    this.receiveOrderChange(pushedOrder(), cx);
    this.check(this.ordersState.today.length === 0, "a push does not invent a list of its own");
    const behind = this.applyPushedOrders(listed());
    this.check(
      behind.map((order) => order.orderId).join(",") === "900,1",
      `a read that is behind keeps the order the gateway already reported: ${behind
        .map((order) => order.orderId)
        .join(",")}`,
    );
    this.check(this.pushedOrders.size === 1, "and goes on holding it until the read agrees");

    // Once the read carries the same version, the pushed copy is let go: the
    // endpoint is the authority, and holding a duplicate would eventually mean
    // holding a stale one.
    this.initOrdersState();
    this.receiveOrderChange(pushedOrder(), cx);
    const caughtUp = this.applyPushedOrders(
      listed({
        order_id: "900",
        symbol: "700.HK",
        status: "NewStatus",
        quantity: "200",
        price: "310.400",
        submitted_at: "1700000300",
        updated_at: "1700000300",
      }),
    );
    this.check(caughtUp.length === 2, "an order the read now carries is not carried twice");
    this.check(this.pushedOrders.size === 0, "and is let go once the read agrees");

    // A read that stays behind for longer than the gap could plausibly be is
    // the better authority anyway: an order that filled and moved to History
    // must not be held in today's list by a push nothing ever supersedes.
    this.initOrdersState();
    this.receiveOrderChange(pushedOrder(), cx);
    const expired = this.applyPushedOrders(
      listed(),
      Date.now() + LongbridgeApp.ORDER_PUSH_GRACE_MS + 1,
    );
    this.check(expired.length === 1, "a push nothing ever confirms is let go of eventually");
    this.check(this.pushedOrders.size === 0, "and is not held for the life of the session");

    // With a list on screen, the push goes straight into it.
    this.initOrdersState();
    this.ordersState = { status: "ready", today: listed(), history: [], error: "" };
    this.receiveOrderChange(pushedOrder(), cx);
    this.check(
      this.ordersState.today.map((order) => order.orderId).join(",") === "900,1",
      "a push reaches a list that is already showing",
    );
    this.check(this.repaints === 1, "and asks for the repaint that shows it");
    const published = this.ordersState;
    const painted = this.repaints;
    this.receiveOrderChange(pushedOrder(), cx);
    this.check(this.ordersState === published, "and a repeat of it does not republish the list");
    this.check(this.repaints === painted, "nor repaint the window for news it already had");
    this.receiveOrderChange(pushedOrder({ status: "FilledStatus", updated_at: "1700000400" }), cx);
    this.check(
      this.ordersState.today[0].statusKind === "filled",
      "while news about it reaches the row it is about",
    );
    this.check(this.ordersState.today.length === 2, "without adding a second row for it");

    // A push channel that cannot be opened is a channel, not a session. It is
    // built on the connect path, ahead of the watchlist's own stream, so a
    // throw here would take prices down with it -- which is exactly what
    // happened when this module reached for a `WebSocket` global that this
    // runtime does not have.
    this.initOrdersState();
    this.tradeStream = null;
    this.buildTradeStream = () => {
      throw new Error("WebSocket is not defined");
    };
    this.startTradeStream("token", 1, cx);
    this.check(this.tradeStream === null, "a channel that will not open is not held as if it had");

    return v_flex()
      .id("order-push-probe")
      .child(this.results.length === 0 ? "ok" : "FAILED")
      .children(this.results);
  }
}
