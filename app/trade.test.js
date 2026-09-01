import { View } from "gpui";
import {
  ANY_TIME,
  RTH_ONLY,
  allowsFractionalShares,
  sharesForAmount,
  supportsAmountSizing,
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

  // Board lots. Hong Kong trades in them; a part lot is refused by the
  // exchange, so it is refused here first -- but only when the lot is known.
  const hk = (overrides = {}) => ticket({ symbol: "700.HK", ...overrides });
  check(
    validateTicket(hk({ quantity: "150" }), { lotSize: 100 }).errors.quantity,
    "a part lot is refused",
  );
  check(validateTicket(hk({ quantity: "200" }), { lotSize: 100 }).ok, "whole lots are allowed");
  check(
    validateTicket(hk({ quantity: "150" }), { lotSize: 100 }).errors.quantity ===
      "Board lot is 100.",
    "the refusal names the lot, so the reader knows what to type",
  );
  check(
    validateTicket(hk({ quantity: "150" }), {}).ok,
    "an unknown lot refuses nothing -- the exchange still enforces it",
  );
  check(
    validateTicket(hk({ quantity: "150" }), { lotSize: null }).ok,
    "an absent lot is not a lot of one",
  );
  check(
    validateTicket(ticket({ quantity: "150" }), { lotSize: 1 }).ok,
    "a lot of one is every quantity, and is not a rule worth stating",
  );
  check(
    validateTicket(hk({ quantity: "0" }), { lotSize: 100 }).errors.quantity ===
      "Quantity must be above zero.",
    "zero is refused as zero, not as a part lot",
  );

  // Sizing by amount. The wire only ever takes a quantity, so an amount is a
  // second way of arriving at that field -- and the arithmetic rounds down
  // twice, to a whole share and then to a whole lot.
  check(sharesForAmount(1500, 214.07) === 7, "an amount buys the whole shares it covers");
  check(sharesForAmount(1500, 214.07, 1) === 7, "a lot of one changes nothing");
  check(sharesForAmount(1500, 214.07, 5) === 5, "a lot rounds the share count down");
  check(sharesForAmount(100, 214.07) === 0, "an amount under one share buys none");

  // Where fractional shares match, the budget is not left an odd hair short:
  // the count is the division to four places, which is the scale Longbridge
  // settles them at.
  check(sharesForAmount(1500, 214.07, null, true) === 7.0071, "a fraction spends the amount");
  check(sharesForAmount(100, 214.07, null, true) === 0.4671, "under a share is still an order");
  check(sharesForAmount(0.01, 214.07, null, true) === 0, "under the minimum fraction is nothing");
  check(
    sharesForAmount(1500, 214.07, 100, true) === 7.0071,
    "a lot does not bound a fraction -- the two do not both apply",
  );
  check(
    allowsFractionalShares({ symbol: "QQQ.US", outsideRth: RTH_ONLY }),
    "a US order in the regular session may be fractional",
  );
  check(
    !allowsFractionalShares({ symbol: "QQQ.US", outsideRth: ANY_TIME }),
    "there is no fractional matching outside the regular session",
  );
  check(
    !allowsFractionalShares({ symbol: "700.HK", outsideRth: null }),
    "Hong Kong trades in lots, not fractions",
  );
  check(sharesForAmount(0, 214.07) === 0, "no amount buys nothing");
  check(sharesForAmount(1500, 0) === 0, "a free instrument is not an infinite one");
  check(sharesForAmount(1500, -1) === 0, "a negative price buys nothing");
  check(sharesForAmount(1500, 500) === 3, "an exact multiple keeps every share");

  const byAmount = (overrides = {}) => ({
    ...emptyTicket("QQQ.US", "Buy"),
    sizing: "amount",
    price: "214.07",
    amount: "1500",
    ...overrides,
  });
  const spend = validateTicket(byAmount());
  check(spend.ok, "1500 USD of QQQ at 214.07 is a valid order");
  check(spend.normalized.quantity === 7.0071, "the amount became a share count");
  check(spend.normalized.amount === 1500, "the amount the reader typed is kept");
  check(spend.normalized.sizing === "amount", "the ticket remembers how it was sized");
  check(
    submitOrderBody(spend.normalized, "r").submitted_quantity === "7.0071",
    "the wire is sent shares, never the amount",
  );
  check(
    !("amount" in submitOrderBody(spend.normalized, "r")),
    "no amount key reaches an endpoint that has none",
  );
  check(validateTicket(byAmount({ amount: "" })).errors.amount, "an empty amount is not zero");
  check(validateTicket(byAmount({ amount: "0" })).errors.amount, "zero is not an amount");
  check(validateTicket(byAmount({ amount: "-5" })).errors.amount, "a negative amount is not one");
  check(
    validateTicket(byAmount({ amount: "10", outsideRth: true })).errors.amount ===
      "Not enough for one share.",
    "an amount under one share says so where fractions do not match",
  );
  check(
    validateTicket(byAmount({ symbol: "700.HK", amount: "1000", price: "320" }), { lotSize: 100 })
      .errors.amount === "Not enough for one lot of 100.",
    "an amount under one board lot names the lot",
  );
  check(
    validateTicket(byAmount({ price: "" })).errors.amount === "Enter a price first.",
    "a limit order sized by amount needs the price it divides by",
  );
  // A quantity typed in the other mode must not leak into this one.
  check(
    validateTicket(byAmount({ quantity: "999" })).normalized.quantity === 7.0071,
    "the amount decides the size, not a stale quantity field",
  );

  // A market order has no price of its own, so it sizes against the last trade
  // -- and records what it used, because a share count nobody can check is an
  // assertion.
  const atMarket = validateTicket(byAmount({ type: "MO", price: "" }), { lastPrice: 214.07 });
  check(atMarket.ok, "a market order can be sized by amount");
  check(atMarket.normalized.quantity === 7.0071, "it sizes against the last trade");
  check(atMarket.normalized.sizedAt === 214.07, "it records what it sized against");
  check(
    validateTicket(byAmount({ type: "MO", price: "" })).errors.amount ===
      "No recent price to size against.",
    "without a recent price there is nothing to divide by",
  );
  check(
    spend.normalized.sizedAt === null,
    "a limit order does not repeat its own price as a basis",
  );

  // Selling is never sized by amount. A sale disposes of shares, and "sell
  // 1500 dollars" names proceeds no order can guarantee -- the price it fills
  // at is not known when it is placed. The mode is not offered on that side,
  // so a form left holding it falls back to the quantity rather than becoming
  // an order nobody could have meant.
  check(!supportsAmountSizing("Sell"), "a sale cannot be sized by amount");
  check(supportsAmountSizing("Buy") && supportsAmountSizing("buy"), "a purchase can");
  const staleSell = validateTicket(byAmount({ side: "Sell", quantity: "3", amount: "1500" }), {
    available: 3,
  });
  check(staleSell.ok, "a sale reads the quantity when the form still says amount");
  check(staleSell.normalized.quantity === 3, "and it is the quantity that is sent");
  check(staleSell.normalized.sizing === "shares", "the order records how it was really sized");

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
