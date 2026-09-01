// Read-only order normalization. The Longbridge trade endpoints answer every
// field as a string, including the enumerations and the timestamps, so this
// module is where an answer becomes a row: one shape, sorted newest first,
// with the statuses named the way a person reads them rather than the way the
// wire spells them. Nothing here decides how a row is drawn.

/**
 * How far back the History request asks for.
 *
 * The endpoint requires a window, and a year is the one the Longbridge
 * terminal uses -- long enough that a quiet account still has something to
 * show, short enough that a busy one is not asking for its whole life.
 */
export const HISTORY_WINDOW_DAYS = 365;

const STATUS_LABELS = Object.freeze({
  NotReported: "Not reported",
  ReplacedNotReported: "Replaced · unreported",
  ProtectedNotReported: "Protected · unreported",
  VarietiesNotReported: "Varieties · unreported",
  WaitToNew: "Pending new",
  New: "New",
  WaitToReplace: "Pending replace",
  PendingReplace: "Replacing",
  Replaced: "Replaced",
  PartialFilled: "Partially filled",
  WaitToCancel: "Pending cancel",
  PendingCancel: "Cancelling",
  Filled: "Filled",
  Canceled: "Cancelled",
  Cancelled: "Cancelled",
  Rejected: "Rejected",
  Expired: "Expired",
  PartialWithdrawal: "Partly withdrawn",
});

/**
 * What each status means for a reader scanning a column of them: whether the
 * order is done, still working, or over without having filled.
 */
const STATUS_KINDS = Object.freeze({
  Filled: "filled",
  PartialFilled: "working",
  New: "working",
  WaitToNew: "working",
  NotReported: "working",
  ReplacedNotReported: "working",
  ProtectedNotReported: "working",
  VarietiesNotReported: "working",
  WaitToReplace: "working",
  PendingReplace: "working",
  Replaced: "working",
  WaitToCancel: "working",
  PendingCancel: "working",
  Rejected: "rejected",
  Expired: "ended",
  Canceled: "ended",
  Cancelled: "ended",
  PartialWithdrawal: "ended",
});

/**
 * The wire spells some statuses with a `Status` suffix and some without --
 * `FilledStatus` beside `NotReported` in the same response -- so both spellings
 * fold to one key rather than one of them falling through to the raw string.
 *
 * @param {unknown} status
 */
function statusKey(status) {
  const text = String(status ?? "").trim();
  return text.endsWith("Status") ? text.slice(0, -"Status".length) : text;
}

/** @param {unknown} status */
export function orderStatusLabel(status) {
  const key = statusKey(status);
  return STATUS_LABELS[key] ?? (key || "--");
}

/** @param {unknown} status @returns {"filled" | "working" | "rejected" | "ended" | "unknown"} */
export function orderStatusKind(status) {
  return STATUS_KINDS[statusKey(status)] ?? "unknown";
}

/**
 * Which side an order is on, as a value the interface can colour by without
 * matching on the word it draws -- the same separation the statuses have.
 *
 * @param {unknown} side @returns {"buy" | "sell" | "unknown"}
 */
export function orderSideKind(side) {
  const key = String(side ?? "")
    .trim()
    .toLowerCase();
  return key === "buy" || key === "sell" ? key : "unknown";
}

/** @param {unknown} side */
export function orderSideLabel(side) {
  const text = String(side ?? "")
    .trim()
    .toLowerCase();
  if (text === "buy") return "Buy";
  if (text === "sell") return "Sell";
  return "--";
}

/**
 * A price the API left empty, or zeroed because the order named no price at
 * all. Both are the absence of a price and neither is the number zero.
 *
 * @param {unknown} value
 */
function priceValue(value) {
  const text = String(value ?? "").trim();
  if (text === "") return "--";
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric === 0 ? "--" : text;
}

/** @param {unknown} value */
function countValue(value) {
  const text = String(value ?? "").trim();
  return text === "" ? "--" : text;
}

/** Unix seconds, as the trade endpoints report them, in milliseconds. */
function timestampMs(value) {
  const seconds = Number(String(value ?? "").trim());
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 0;
}

/** @param {unknown} value */
function text(value) {
  return typeof value === "string" ? value : "";
}

/**
 * One order, as a row.
 *
 * The identity is the order ID rather than the symbol: an account can hold
 * several orders on one instrument, and a list keyed by instrument would
 * collapse them onto each other.
 *
 * @param {Record<string, unknown>} order
 */
function normalizeOrder(order) {
  const symbol = text(order.symbol);
  const [code, market = ""] = symbol.split(".");
  const status = order.status;
  return Object.freeze({
    orderId: text(order.order_id ?? order.orderId),
    symbol,
    code: code || symbol,
    market,
    name: text(order.stock_name ?? order.stockName) || code || symbol,
    side: text(order.side),
    sideKind: orderSideKind(order.side),
    sideLabel: orderSideLabel(order.side),
    type: text(order.order_type ?? order.orderType) || "--",
    status: text(status),
    statusLabel: orderStatusLabel(status),
    statusKind: orderStatusKind(status),
    quantity: countValue(order.quantity),
    executedQuantity: countValue(order.executed_quantity ?? order.executedQuantity),
    price: priceValue(order.price),
    executedPrice: priceValue(order.executed_price ?? order.executedPrice),
    lastDone: priceValue(order.last_done ?? order.lastDone),
    triggerPrice: priceValue(order.trigger_price ?? order.triggerPrice),
    currency: text(order.currency),
    timeInForce: text(order.time_in_force ?? order.timeInForce) || "--",
    outsideRth: text(order.outside_rth ?? order.outsideRth),
    tag: text(order.tag),
    submittedAt: timestampMs(order.submitted_at ?? order.submittedAt),
    updatedAt: timestampMs(order.updated_at ?? order.updatedAt),
    message: text(order.msg),
    remark: text(order.remark),
  });
}

/**
 * The orders in a trade response, newest first.
 *
 * Both endpoints answer `{ data: { orders: [...] } }`, and both have been seen
 * to answer the bare list, so the payload is unwrapped rather than indexed.
 *
 * @param {unknown} payload
 */
export function normalizeOrders(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const data = root.data && typeof root.data === "object" ? root.data : root;
  const source = Array.isArray(data.orders) ? data.orders : Array.isArray(data) ? data : [];
  const rows = source
    .filter((order) => order && typeof order === "object")
    .map((order) => normalizeOrder(order));
  // Ties keep the order the API answered in, which is the only tiebreak that
  // does not invent a ranking of its own.
  return Object.freeze(
    rows
      .map((order, index) => ({ order, index }))
      .sort(
        (left, right) =>
          right.order.submittedAt - left.order.submittedAt || left.index - right.index,
      )
      .map(({ order }) => order),
  );
}

/**
 * One order as the push channel spells it.
 *
 * The trade gateway and the order endpoints describe the same order in
 * different words: what the list calls `quantity` and `price`, the push calls
 * `submitted_quantity` and `submitted_price`. Renamed here rather than in
 * `normalizeOrder`, so the row shape stays defined by one vocabulary and the
 * translation is visible in one place.
 *
 * Fields the push does not carry -- `last_done`, and the market's own name for
 * the instrument on some venues -- are simply absent, and normalize to the same
 * `--` an endpoint's empty string does.
 *
 * @param {Record<string, unknown>} pushed
 */
export function normalizePushedOrder(pushed) {
  return normalizeOrder({
    ...pushed,
    quantity: pushed.quantity ?? pushed.submitted_quantity,
    price: pushed.price ?? pushed.submitted_price,
  });
}

/**
 * The list with one order's news applied: replaced where it is, inserted where
 * it is not.
 *
 * Insertion keeps the list's own ordering -- newest submission first -- rather
 * than putting the news at the top, because a replaced order keeps the
 * submission time it has always had and would otherwise jump the queue every
 * time it filled a little further.
 *
 * The list is returned unchanged when nothing about the order differs, so a
 * repeated push -- the gateway sends one per state change, and some states
 * repeat -- does not cost a repaint.
 *
 * @param {readonly LongbridgeOrderRow[]} orders
 * @param {LongbridgeOrderRow} order
 */
export function mergeOrder(orders, order) {
  const index = orders.findIndex((candidate) => candidate.orderId === order.orderId);
  if (index >= 0) {
    const existing = orders[index];
    if (Object.keys(order).every((key) => existing[key] === order[key])) return orders;
    const merged = orders.slice();
    merged[index] = order;
    return Object.freeze(merged);
  }
  const at = orders.findIndex((candidate) => candidate.submittedAt < order.submittedAt);
  const merged = orders.slice();
  merged.splice(at >= 0 ? at : merged.length, 0, order);
  return Object.freeze(merged);
}

/**
 * The window the History request asks for, as the endpoint spells it: whole
 * unix seconds, start before end.
 *
 * @param {number} [now]
 * @param {number} [days]
 */
export function historyRange(now = Date.now(), days = HISTORY_WINDOW_DAYS) {
  const end = Math.floor(now / 1_000);
  const span = Math.max(1, Math.floor(days)) * 86_400;
  return Object.freeze({ start_at: String(end - span), end_at: String(end) });
}
