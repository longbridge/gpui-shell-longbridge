// Everything about placing, changing and withdrawing an order that is not a
// request: what a ticket has to say before it is worth sending, what the wire
// wants it to look like, and which of an account's existing orders can still
// be changed or taken back.
//
// The reading side stays in `orders.js`. This is the writing side, and it is
// pure for the same reason that one is -- but here the reason has teeth: this
// is the module that decides whether real money moves, and a decision that
// needs a socket to be checked is a decision nobody checks.

import { orderStatusKind } from "./orders.js";

/**
 * The order types this client places.
 *
 * Longbridge accepts eleven, and the other nine are conditional orders --
 * touched, trailing, auction -- each carrying fields of its own that appear
 * and disappear with the type. These two are the ones that mean the same
 * thing in every market this application shows, and they are the whole of a
 * ticket: a price and an amount, or an amount.
 */
export const ORDER_TYPES = Object.freeze([
  Object.freeze({ value: "LO", label: "Limit" }),
  Object.freeze({ value: "MO", label: "Market" }),
]);

/**
 * How long an order stands.
 *
 * `GTD` is Longbridge's third, and it takes an expiry date -- a date field,
 * a calendar, and a whole class of "that date is in the past" to answer. Day
 * and good-till-cancelled are the two that need nothing but themselves.
 */
export const TIME_IN_FORCE = Object.freeze([
  Object.freeze({ value: "Day", label: "Day" }),
  Object.freeze({ value: "GTC", label: "Till cancelled" }),
]);

/** Sessions a US order may fill in. */
export const RTH_ONLY = "RTH_ONLY";
export const ANY_TIME = "ANY_TIME";

/** @param {unknown} type */
export function isLimitOrder(type) {
  return String(type ?? "") === "LO";
}

/**
 * Whether a symbol trades in the market that has a pre- and post-market at
 * all. `outside_rth` is required on US orders and meaningless everywhere
 * else, so the question is the market's, not the ticket's.
 *
 * @param {unknown} symbol
 */
export function hasExtendedHours(symbol) {
  return String(symbol ?? "")
    .toUpperCase()
    .endsWith(".US");
}

/** @param {unknown} side @returns {"Buy" | "Sell"} */
function normalizeSide(side) {
  return String(side ?? "").toLowerCase() === "sell" ? "Sell" : "Buy";
}

/**
 * A typed number, or `null`.
 *
 * `Number("")` is 0 and `Number(" ")` is 0, which would turn an empty price
 * field into a free order and an empty quantity into a valid one. An empty
 * field is not a zero; it is the absence of an answer, and it comes back as
 * one.
 *
 * @param {unknown} value
 */
function typedNumber(value) {
  const text = String(value ?? "").trim();
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @typedef {{
 *   symbol: string,
 *   side: string,
 *   type: string,
 *   price: string,
 *   quantity: string,
 *   timeInForce: string,
 *   outsideRth: boolean,
 * }} TicketForm
 */

/**
 * A ticket with nothing filled in, for the instrument and direction chosen.
 *
 * @param {string} symbol @param {string} side @returns {TicketForm}
 */
export function emptyTicket(symbol, side) {
  return Object.freeze({
    symbol: String(symbol ?? ""),
    side: normalizeSide(side),
    type: "LO",
    price: "",
    quantity: "",
    timeInForce: "Day",
    outsideRth: false,
  });
}

/**
 * What is wrong with a ticket, field by field.
 *
 * Errors are keyed rather than collected into a list so the interface can put
 * each one under the field it is about. `form` holds the ones that belong to
 * no single field -- selling more than is held is about the pair of them.
 *
 * Both facts about the instrument may be absent, and absent is not zero:
 *
 * `available` is the quantity a sale may not exceed, or `null` when the
 * account's position is not known. Not knowing is not the same as owning
 * none: a portfolio that has not loaded yet would otherwise refuse every
 * sale on the grounds that it had not looked.
 *
 * `lotSize` is the board lot, or `null` when it has not been looked up. A
 * lot that is not known refuses nothing -- the exchange still enforces it,
 * and the refusal comes back with its reason, which is better than this
 * module inventing a rule it cannot see.
 *
 * @param {TicketForm} form
 * @param {{ available?: number | null, lotSize?: number | null }} [context]
 */
export function validateTicket(form, context = {}) {
  /** @type {{ price?: string, quantity?: string, form?: string }} */
  const errors = {};
  const symbol = String(form?.symbol ?? "").trim();
  const side = normalizeSide(form?.side);
  const type = String(form?.type ?? "");
  const limit = isLimitOrder(type);

  const price = typedNumber(form?.price);
  if (limit) {
    if (price === null) errors.price = "Enter a price.";
    else if (price <= 0) errors.price = "Price must be above zero.";
  }

  const lotSize = context.lotSize ?? null;
  const quantity = typedNumber(form?.quantity);
  if (quantity === null) errors.quantity = "Enter a quantity.";
  else if (quantity <= 0) errors.quantity = "Quantity must be above zero.";
  else if (!Number.isInteger(quantity)) errors.quantity = "Quantity must be a whole number.";
  // A board lot of one is every quantity, so it is not a rule worth stating.
  else if (lotSize !== null && lotSize > 1 && quantity % lotSize !== 0) {
    errors.quantity = `${symbol.split(".")[1] === "HK" ? "Board lot" : "Lot"} is ${lotSize}.`;
  }

  const available = context.available ?? null;
  if (
    side === "Sell" &&
    available !== null &&
    quantity !== null &&
    Number.isInteger(quantity) &&
    quantity > available
  ) {
    errors.form = `This account holds ${available}.`;
  }

  if (symbol === "") errors.form = "No instrument selected.";

  const ok = Object.keys(errors).length === 0;
  return Object.freeze({
    ok,
    errors: Object.freeze(errors),
    normalized: ok
      ? Object.freeze({
          symbol,
          side,
          type,
          price: limit ? price : null,
          quantity: /** @type {number} */ (quantity),
          timeInForce: String(form?.timeInForce ?? "Day"),
          outsideRth: hasExtendedHours(symbol) ? (form?.outsideRth ? ANY_TIME : RTH_ONLY) : null,
        })
      : null,
  });
}

/**
 * The submit request, as `POST /v1/trade/order` wants it.
 *
 * Every value goes over as a string, including the quantity -- that is the
 * endpoint's own shape, not a convenience. A market order carries no
 * `submitted_price` at all rather than an empty one.
 *
 * `clientRequestId` is passed in rather than generated here so the body stays
 * a function of its arguments. It is what makes a retried submit idempotent:
 * Longbridge caches the id for ten minutes and answers the first order again
 * instead of placing a second. Sending nothing here is legal and is how a
 * dropped response becomes two positions.
 *
 * @param {NonNullable<ReturnType<typeof validateTicket>["normalized"]>} order
 * @param {string} clientRequestId
 */
export function submitOrderBody(order, clientRequestId) {
  /** @type {Record<string, string>} */
  const body = {
    symbol: order.symbol,
    order_type: order.type,
    side: order.side,
    submitted_quantity: String(order.quantity),
    time_in_force: order.timeInForce,
  };
  if (order.price !== null) body.submitted_price = String(order.price);
  if (order.outsideRth !== null) body.outside_rth = order.outsideRth;
  if (clientRequestId) body.client_request_id = clientRequestId;
  return Object.freeze(body);
}

/**
 * The replace request, as `PUT /v1/trade/order` wants it.
 *
 * Quantity is required even when only the price is being changed, so an
 * unchanged quantity is still sent. The price is sent only for the order
 * types that have one.
 *
 * @param {string} orderId
 * @param {NonNullable<ReturnType<typeof validateTicket>["normalized"]>} order
 */
export function replaceOrderBody(orderId, order) {
  /** @type {Record<string, string>} */
  const body = {
    order_id: String(orderId),
    quantity: String(order.quantity),
  };
  if (order.price !== null) body.price = String(order.price);
  return Object.freeze(body);
}

/**
 * The withdraw request, as `DELETE /v1/trade/order` wants it.
 *
 * @param {string | number} orderId
 */
export function cancelOrderBody(orderId) {
  return Object.freeze({ order_id: String(orderId) });
}

/**
 * Whether an order is still live enough to act on.
 *
 * `orderStatusKind` already folds Longbridge's seventeen statuses into four
 * outcomes, and "working" is exactly the set that has not finished: anything
 * filled, rejected, cancelled or expired is over, and changing something that
 * is over is a request that can only be refused.
 *
 * @param {{ status?: unknown }} order
 */
export function canCancel(order) {
  return orderStatusKind(order?.status) === "working";
}

/**
 * Whether an order can be modified.
 *
 * Everything `canCancel` allows, less `SLO` -- the special limit order, which
 * Longbridge documents as not supporting replacement. Offering it would put a
 * rejection behind a menu item.
 *
 * @param {{ status?: unknown, type?: unknown }} order
 */
export function canReplace(order) {
  return canCancel(order) && String(order?.type ?? "") !== "SLO";
}

/**
 * What the order is expected to cost, or `null` when that cannot be said.
 *
 * A market order has no estimate. Showing one -- the last traded price times
 * the quantity -- would put a number in front of someone that the order does
 * not promise and the market need not honour, which is the one thing a
 * confirmation screen must not do.
 *
 * @param {{ price: number | null, quantity: number }} order
 */
export function estimatedAmount(order) {
  if (!order || order.price === null || !Number.isFinite(order.price)) return null;
  return order.price * order.quantity;
}

/**
 * An amount, to the cent, grouped in thousands.
 *
 * `toLocaleString` is the obvious way to write this and it does not work: the
 * runtime is QuickJS, whose `Intl` is not the browser's, and the grouping is
 * silently dropped -- `18850.00` where `18,850.00` was asked for. An amount
 * someone is about to commit is exactly the number that has to be readable at
 * a glance, so the grouping is done here rather than hoped for.
 *
 * @param {number} amount
 */
function formatAmount(amount) {
  const fixed = Math.abs(amount).toFixed(2);
  const [whole, cents] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${amount < 0 ? "-" : ""}${grouped}.${cents}`;
}

/**
 * The confirmation screen's lines.
 *
 * The wording lives here rather than in the view because what a confirmation
 * has to state is a property of the order, not of its layout: the direction,
 * the instrument, the amount, the price or the absence of one, how long it
 * stands, and which sessions it may fill in.
 *
 * @param {NonNullable<ReturnType<typeof validateTicket>["normalized"]>} order
 * @param {{ currency?: string, name?: string }} [instrument]
 */
export function ticketSummary(order, instrument = {}) {
  const currency = String(instrument.currency ?? "").trim();
  const amount = estimatedAmount(order);
  const timeInForce =
    TIME_IN_FORCE.find((entry) => entry.value === order.timeInForce)?.label ?? order.timeInForce;
  const sessions =
    order.outsideRth === null
      ? ""
      : order.outsideRth === ANY_TIME
        ? "Pre- and post-market"
        : "Regular hours only";
  return Object.freeze({
    side: order.side,
    sideKind: order.side.toLowerCase(),
    symbol: order.symbol,
    name: String(instrument.name ?? "").trim(),
    quantity: String(order.quantity),
    type: ORDER_TYPES.find((entry) => entry.value === order.type)?.label ?? order.type,
    price:
      order.price === null ? "Market price" : `${order.price}${currency ? ` ${currency}` : ""}`,
    timeInForce,
    sessions,
    amount: amount === null ? "--" : `${formatAmount(amount)}${currency ? ` ${currency}` : ""}`,
  });
}
