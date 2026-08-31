import { View } from "gpui";
import {
  ANY_TIME,
  RTH_ONLY,
  canCancel,
  canReplace,
  cancelOrderBody,
  emptyTicket,
  estimatedAmount,
  hasExtendedHours,
  isLimitOrder,
  replaceOrderBody,
  submitOrderBody,
  ticketSummary,
  validateTicket,
} from "./trade.js";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

/** A ticket that passes, so each vector can spoil exactly one thing. */
function ticket(overrides = {}) {
  return { ...emptyTicket("AAPL.US", "Buy"), price: "188.5", quantity: "100", ...overrides };
}

function runVectors() {
  check(isLimitOrder("LO") && !isLimitOrder("MO"), "only a limit order carries a price");
  check(
    hasExtendedHours("AAPL.US") && !hasExtendedHours("700.HK"),
    "only US symbols have a session outside regular hours",
  );
  check(emptyTicket("700.HK", "sell").side === "Sell", "a side is normalized to the wire spelling");
  check(emptyTicket("700.HK", "nonsense").side === "Buy", "an unreadable side is not a sale");

  // Quantity.
  check(validateTicket(ticket({ quantity: "" })).errors.quantity, "an empty quantity is not zero");
  check(validateTicket(ticket({ quantity: "0" })).errors.quantity, "zero is not a quantity");
  check(
    validateTicket(ticket({ quantity: "-5" })).errors.quantity,
    "a negative quantity is not one",
  );
  check(validateTicket(ticket({ quantity: "1.5" })).errors.quantity, "shares are whole");
  check(validateTicket(ticket({ quantity: "abc" })).errors.quantity, "a word is not a quantity");

  // Price, and the type that has none.
  check(validateTicket(ticket({ price: "" })).errors.price, "a limit order needs its price");
  check(validateTicket(ticket({ price: "0" })).errors.price, "a limit price is above zero");
  const market = validateTicket(ticket({ type: "MO", price: "" }));
  check(market.ok, "a market order needs no price");
  check(market.normalized.price === null, "a market order carries no price at all");

  // Selling more than is held.
  check(
    validateTicket(ticket({ side: "Sell", quantity: "200" }), { available: 100 }).errors.form,
    "a sale may not exceed the position",
  );
  check(
    validateTicket(ticket({ side: "Sell", quantity: "100" }), { available: 100 }).ok,
    "selling the whole position is allowed",
  );
  check(
    validateTicket(ticket({ side: "Sell", quantity: "200" }), { available: null }).ok,
    "an unknown position refuses nothing -- not knowing is not owning none",
  );
  check(
    validateTicket(ticket({ side: "Buy", quantity: "200" }), { available: 1 }).ok,
    "a position does not bound a purchase",
  );
  check(validateTicket(ticket({ symbol: "" })).errors.form, "an order needs an instrument");

  // Sessions.
  check(
    validateTicket(ticket()).normalized.outsideRth === RTH_ONLY,
    "a US order defaults to regular hours",
  );
  check(
    validateTicket(ticket({ outsideRth: true })).normalized.outsideRth === ANY_TIME,
    "the extended-hours switch reaches the wire",
  );
  check(
    validateTicket(ticket({ symbol: "700.HK" })).normalized.outsideRth === null,
    "a Hong Kong order says nothing about sessions",
  );

  // The wire's own shape.
  const body = submitOrderBody(validateTicket(ticket()).normalized, "request-1");
  check(body.symbol === "AAPL.US", "the symbol goes over as given");
  check(body.order_type === "LO" && body.side === "Buy", "type and side are the wire's spellings");
  check(body.submitted_quantity === "100", "the quantity is a string, as the endpoint wants");
  check(body.submitted_price === "188.5", "a limit price is sent");
  check(body.time_in_force === "Day", "the default order stands for the day");
  check(body.outside_rth === RTH_ONLY, "the session is sent for a US order");
  check(body.client_request_id === "request-1", "the idempotency key reaches the request");
  check(
    !("submitted_price" in submitOrderBody(market.normalized, "request-2")),
    "a market order omits the price key rather than sending an empty one",
  );
  check(
    !(
      "outside_rth" in submitOrderBody(validateTicket(ticket({ symbol: "700.HK" })).normalized, "x")
    ),
    "a non-US order omits the session key",
  );
  check(
    !("client_request_id" in submitOrderBody(validateTicket(ticket()).normalized, "")),
    "no key is sent rather than an empty idempotency key",
  );

  const replace = replaceOrderBody("701276261045858304", validateTicket(ticket()).normalized);
  check(replace.order_id === "701276261045858304", "a replacement names its order");
  check(replace.quantity === "100", "a replacement always sends the quantity");
  check(replace.price === "188.5", "a limit replacement sends the price");
  check(
    !("price" in replaceOrderBody("1", market.normalized)),
    "a market replacement sends no price",
  );
  check(cancelOrderBody(12345).order_id === "12345", "a withdrawal names its order as a string");

  // Which orders can still be acted on.
  check(canCancel({ status: "NewStatus" }), "a working order can be withdrawn");
  check(canCancel({ status: "PartialFilledStatus" }), "a partly filled order is still working");
  check(!canCancel({ status: "FilledStatus" }), "a filled order cannot be withdrawn");
  check(
    !canCancel({ status: "CanceledStatus" }),
    "an order already gone cannot be withdrawn again",
  );
  check(!canCancel({ status: "RejectedStatus" }), "a rejected order is over");
  check(canReplace({ status: "NewStatus", type: "LO" }), "a working limit order can be changed");
  check(
    !canReplace({ status: "NewStatus", type: "SLO" }),
    "a special limit order does not support replacement",
  );
  check(!canReplace({ status: "FilledStatus", type: "LO" }), "a filled order cannot be changed");

  // What the confirmation screen is allowed to claim.
  check(
    estimatedAmount({ price: 188.5, quantity: 100 }) === 18_850,
    "an estimate is price by size",
  );
  check(
    estimatedAmount({ price: null, quantity: 100 }) === null,
    "a market order has no estimate, and zero would be a claim",
  );

  const summary = ticketSummary(validateTicket(ticket()).normalized, {
    currency: "USD",
    name: "Apple Inc.",
  });
  check(summary.side === "Buy" && summary.sideKind === "buy", "the summary carries both spellings");
  check(summary.type === "Limit", "the summary names the type in words");
  check(summary.price === "188.5 USD", "a limit price is shown with its currency");
  check(summary.amount === "18,850.00 USD", "the estimate is grouped and to the cent");
  check(summary.sessions === "Regular hours only", "the summary states which sessions apply");
  const marketSummary = ticketSummary(market.normalized, { currency: "USD" });
  check(marketSummary.price === "Market price", "a market order says so where a price would be");
  check(marketSummary.amount === "--", "a market order shows no estimate");
}

runVectors();

export default class TradeVectorProbe extends View {
  render() {
    return { type: "text", text: "ok" };
  }
}
