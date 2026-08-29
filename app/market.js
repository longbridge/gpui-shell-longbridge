// Read-only watchlist normalization and quote-state reduction. Keeping this
// independent from rendering makes API order, sorting and push merging deterministic.

const CURRENCY_BY_MARKET = Object.freeze({ US: "USD", HK: "HKD", SG: "SGD", SH: "CNY", SZ: "CNY" });
const MARKET_PRIORITY = Object.freeze({ US: 0, HK: 1, SH: 2, SZ: 2, SG: 3 });

export function watchlistInstruments(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const data = root.data && typeof root.data === "object" ? root.data : root;
  const groups = Array.isArray(data.groups) ? data.groups : [];
  const seen = new Set();
  const instruments = [];
  for (const group of groups) {
    for (const security of Array.isArray(group?.securities) ? group.securities : []) {
      if (!security || typeof security.symbol !== "string" || seen.has(security.symbol)) continue;
      seen.add(security.symbol);
      const [code, suffix = ""] = security.symbol.split(".");
      const market =
        typeof security.market === "string" && security.market ? security.market : suffix;
      instruments.push({
        symbol: security.symbol,
        code,
        name: typeof security.name === "string" && security.name ? security.name : code,
        market,
        currency: CURRENCY_BY_MARKET[market] ?? market,
      });
    }
  }
  return instruments;
}

const TRADE_STATUS = Object.freeze({
  0: "Trading",
  1: "Halted",
  2: "Delisted",
  3: "Volatility halt",
  4: "Preparing to list",
  5: "Code moved",
  6: "Pre-open",
  7: "Split halt",
  8: "Expired",
  9: "Preparing to list",
  10: "Suspended",
});

const TRADE_SESSION = Object.freeze({
  0: "Trading",
  1: "Pre",
  2: "Post-market",
  3: "Overnight",
});

const ALIASES = Object.freeze({
  last: ["lastDone", "last_done", "last"],
  prevClose: ["prevClose", "prev_close"],
  open: ["open"],
  high: ["high"],
  low: ["low"],
  timestamp: ["timestamp"],
  volume: ["volume"],
  turnover: ["turnover"],
  tradeStatus: ["tradeStatus", "trade_status"],
  tradeSession: ["tradeSession", "trade_session"],
  sequence: ["sequence"],
  currentVolume: ["currentVolume", "current_volume"],
  currentTurnover: ["currentTurnover", "current_turnover"],
});

function firstDefined(record, names) {
  for (const name of names) if (record[name] !== undefined) return record[name];
  return undefined;
}

function hasMarketValue(value) {
  return value !== undefined && value !== "--" && value !== 0n;
}

function decimals(value) {
  if (typeof value !== "string") return 2;
  const dot = value.indexOf(".");
  return dot < 0 ? 2 : Math.min(4, Math.max(2, value.length - dot - 1));
}

function deriveChange(quote) {
  const last = Number(quote.last);
  const previous = Number(quote.prevClose);
  if (!Number.isFinite(last) || !Number.isFinite(previous) || previous === 0) {
    return { change: "--", changePercent: "--" };
  }
  const change = last - previous;
  const sign = change > 0 ? "+" : "";
  const precision = Math.max(decimals(quote.last), decimals(quote.prevClose));
  return {
    change: `${sign}${change.toFixed(precision)}`,
    changePercent: `${sign}${((change / previous) * 100).toFixed(2)}%`,
  };
}

export function initialQuotes(instruments = []) {
  return instruments.map((instrument) => ({
    ...instrument,
    last: "--",
    prevClose: "--",
    open: "--",
    high: "--",
    low: "--",
    volume: 0n,
    turnover: "--",
    tradeStatus: undefined,
    tradeSession: undefined,
    sequence: undefined,
    updatedAt: 0,
    receivedAt: 0,
    change: "--",
    changePercent: "--",
  }));
}

function isUsDaylightSavingTime(now) {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  const nthSunday = (month, nth) => {
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
    return Date.UTC(year, month, 1 + ((7 - first) % 7) + (nth - 1) * 7);
  };
  const day = Date.UTC(year, date.getUTCMonth(), date.getUTCDate());
  return day >= nthSunday(2, 2) && day < nthSunday(10, 1);
}

function isWeekdayAtOffset(now, offsetMinutes) {
  const weekday = new Date(now + offsetMinutes * 60_000).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

export function marketIsOpen(market, now = Date.now()) {
  const date = new Date(now);
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const inRange = (start, end) => utcMinutes >= start && utcMinutes < end;
  if (market === "US") {
    const daylight = isUsDaylightSavingTime(now);
    const offset = daylight ? -4 * 60 : -5 * 60;
    return (
      isWeekdayAtOffset(now, offset) &&
      inRange(daylight ? 13 * 60 + 30 : 14 * 60 + 30, daylight ? 20 * 60 : 21 * 60)
    );
  }
  if (!isWeekdayAtOffset(now, 8 * 60)) return false;
  if (market === "HK") return inRange(90, 240) || inRange(300, 480);
  if (market === "SH" || market === "SZ") return inRange(90, 180) || inRange(300, 420);
  if (market === "SG") return inRange(60, 540);
  return false;
}

function marketKey(market) {
  return market === "SH" || market === "SZ" ? "CN" : market;
}

function marketSessionRanks(quotes, now) {
  const counts = new Map();
  for (const quote of quotes) {
    if (quote.tradeSession === undefined || quote.tradeSession === null) continue;
    if (!(Number(quote.last) > 0)) continue;
    const market = marketKey(quote.market);
    const rank = quote.tradeSession === 0 ? 0 : quote.tradeSession === 1 ? 1 : 2;
    const marketCounts = counts.get(market) ?? [0, 0, 0];
    marketCounts[rank] += 1;
    counts.set(market, marketCounts);
  }

  const ranks = new Map();
  for (const quote of quotes) {
    const market = marketKey(quote.market);
    if (ranks.has(market)) continue;
    const marketCounts = counts.get(market);
    if (!marketCounts) {
      const hasUsableSnapshot = quotes.some(
        (candidate) => marketKey(candidate.market) === market && Number(candidate.last) > 0,
      );
      ranks.set(market, hasUsableSnapshot && marketIsOpen(quote.market, now) ? 0 : 2);
      continue;
    }
    const highestCount = Math.max(...marketCounts);
    ranks.set(
      market,
      marketCounts.findIndex((count) => count === highestCount),
    );
  }
  return ranks;
}

export function sortLikeTerminal(quotes, now = Date.now()) {
  const sessionRanks = marketSessionRanks(quotes, now);
  return quotes
    .map((quote, index) => ({ quote, index }))
    .sort((left, right) => {
      const leftKey = [
        sessionRanks.get(marketKey(left.quote.market)) ?? 2,
        MARKET_PRIORITY[left.quote.market] ?? 99,
      ];
      const rightKey = [
        sessionRanks.get(marketKey(right.quote.market)) ?? 2,
        MARKET_PRIORITY[right.quote.market] ?? 99,
      ];
      return leftKey[0] - rightKey[0] || leftKey[1] - rightKey[1] || left.index - right.index;
    })
    .map(({ quote }) => quote);
}

export function mergeQuote(current, incoming, receivedAt = Date.now()) {
  if (!incoming || typeof incoming !== "object") return current;
  const symbol = firstDefined(incoming, ["symbol"]);
  if (symbol !== current.symbol) return current;
  const incomingSequence = firstDefined(incoming, ALIASES.sequence);
  if (
    typeof incomingSequence === "bigint" &&
    typeof current.sequence === "bigint" &&
    incomingSequence <= current.sequence
  )
    return current;

  const next = { ...current };
  const snapshotAfterPush = incomingSequence === undefined && typeof current.sequence === "bigint";
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const value = firstDefined(incoming, aliases);
    if (value === undefined) continue;
    if (snapshotAfterPush && field !== "prevClose" && hasMarketValue(current[field])) continue;
    next[field] = value;
  }
  if (next.timestamp !== undefined) {
    const seconds =
      typeof next.timestamp === "bigint" ? Number(next.timestamp) : Number(next.timestamp);
    if (Number.isFinite(seconds)) next.updatedAt = seconds * 1_000;
  }
  next.receivedAt = receivedAt;
  return { ...next, ...deriveChange(next) };
}

/**
 * Merges an incoming quote into the row that owns its symbol, returning the
 * same list when nothing changed.
 *
 * Order is deliberately left alone. `sortLikeTerminal` ranks a row from trade
 * session counts taken across the whole list, so it cannot be applied to one
 * row, and running it per quote made the connect burst -- the entire
 * watchlist twice over, snapshot plus isFirstPush, in a single synchronous
 * run -- cost seconds against a real watchlist. That overran the budget the
 * sandbox gives one task, and the interrupt unwound the stream past its own
 * error handling, so it never reached `connected` and never reconnected.
 * Ordering stays fresh on the one-second clock that already re-sorts.
 */
export function applyQuote(quotes, incoming, receivedAt = Date.now()) {
  return applyQuotes(quotes, [incoming], receivedAt);
}

/**
 * Applies a burst of pushes in one pass.
 *
 * `applyQuote` publishes a new list per quote: it scans for the symbol and
 * copies the whole array. That is right for one push and wrong for the burst a
 * connection opens with -- every instrument twice over, the snapshot and then
 * the first push, in one synchronous run. At fifty-six instruments that is a
 * hundred and twelve scans and a hundred and twelve copies of a fifty-six
 * element array, which is the shape that overran the sandbox's budget and left
 * the run interrupted.
 *
 * This indexes once, merges in place, and copies once. Out-of-order pushes are
 * still refused, because that judgement belongs to `mergeQuote` and it is
 * applied per quote here exactly as it is there.
 *
 * @param {LongbridgeQuoteRow[]} quotes
 * @param {unknown[]} incoming In arrival order.
 * @param {number} [receivedAt]
 */
export function applyQuotes(quotes, incoming, receivedAt = Date.now()) {
  if (!Array.isArray(incoming) || incoming.length === 0) return quotes;
  /** @type {Map<string, number>} */
  const positions = new Map();
  for (let position = 0; position < quotes.length; position += 1) {
    positions.set(quotes[position].symbol, position);
  }

  let next = null;
  for (const quote of incoming) {
    if (!quote || typeof quote !== "object") continue;
    const position = positions.get(quote.symbol);
    if (position === undefined) continue;
    const rows = next ?? quotes;
    const merged = mergeQuote(rows[position], quote, receivedAt);
    if (merged === rows[position]) continue;
    // The copy happens once, on the first push that actually changes
    // something; everything after it merges into the list already copied.
    if (!next) next = quotes.slice();
    next[position] = merged;
  }
  return next ?? quotes;
}

export function quoteFreshness(quote, now = Date.now()) {
  if (!quote || !quote.receivedAt) return "waiting";
  return now - quote.receivedAt < 15_000 ? "live" : "stale";
}

export function tradeStatusLabel(quote, now = Date.now()) {
  if (quote?.tradeStatus !== undefined && quote.tradeStatus !== 0) {
    return TRADE_STATUS[quote.tradeStatus] ?? `Status ${quote.tradeStatus}`;
  }
  if (quote?.tradeSession !== undefined) return TRADE_SESSION[quote.tradeSession] ?? "Trading";
  if (!quote?.receivedAt) return "Waiting";
  if (!quote.market) return "Trading";
  return marketIsOpen(quote.market, now) ? "Trading" : "Closed";
}

/**
 * The day's high-low span as a share of the previous close.
 *
 * Derived here rather than at the call site because it is a reading about the
 * session, not a way of drawing one: the same rule -- an unusable input is
 * "--", never a number worked out from a partial snapshot -- applies to every
 * derived figure in this module.
 *
 * @param {LongbridgeQuoteRow} quote
 */
export function amplitude(quote) {
  const high = Number(quote?.high);
  const low = Number(quote?.low);
  const previous = Number(quote?.prevClose);
  if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(previous)) return "--";
  if (previous === 0) return "--";
  return `${(((high - low) / previous) * 100).toFixed(2)}%`;
}

/** Turnover over volume: what the average share changed hands at today. */
export function averagePrice(quote) {
  const turnover = Number(quote?.turnover);
  const volume = typeof quote?.volume === "bigint" ? Number(quote.volume) : Number(quote?.volume);
  if (!Number.isFinite(turnover) || !Number.isFinite(volume) || volume <= 0) return "--";
  return (turnover / volume).toFixed(decimals(quote?.last));
}

/**
 * Movement since the open, which the day's change -- measured against the
 * previous close -- hides whenever a session gaps.
 *
 * @param {LongbridgeQuoteRow} quote
 */
export function changeFromOpen(quote) {
  const last = Number(quote?.last);
  const open = Number(quote?.open);
  if (!Number.isFinite(last) || !Number.isFinite(open) || open === 0) return "--";
  const percent = ((last - open) / open) * 100;
  return `${percent > 0 ? "+" : ""}${percent.toFixed(2)}%`;
}

export function formatCompactNumber(value) {
  const number = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isFinite(number) || number === 0) return "--";
  const absolute = Math.abs(number);
  const units = [
    [1_000_000_000_000, "T"],
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "K"],
  ];
  for (const [threshold, suffix] of units) {
    if (absolute >= threshold)
      return `${(number / threshold).toFixed(2).replace(/\.00$/, "")}${suffix}`;
  }
  return String(number);
}

export function streamStatusSummary(status) {
  const state = status?.state ?? "offline";
  const labels = {
    offline: "Offline",
    connecting: "Connecting",
    restoring_token: "Restoring session",
    loading_watchlist: "Loading watchlist",
    authenticating: "Authenticating",
    subscribing: "Subscribing",
    snapshotting: "Loading snapshot",
    connected: "Streaming",
    stopped: "Stopped",
    error: "Connection error",
  };
  if (state === "reconnecting") {
    const seconds = Math.max(1, Math.ceil(Number(status.delay ?? 0) / 1_000));
    const reason = typeof status.error === "string" && status.error ? ` · ${status.error}` : "";
    return `Retrying in ${seconds}s${reason}`;
  }
  return labels[state] ?? String(state);
}

/**
 * Narrows rows to those whose named fields contain `query`, case-insensitively.
 *
 * Pure and shared, because Watchlist and Holdings ask the same question of
 * different shapes. An empty or blank query is not a filter — it returns the
 * rows untouched rather than an empty list.
 */
export function filterRows(rows, query, fields) {
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!Array.isArray(rows) || needle === "") return Array.isArray(rows) ? rows : [];
  return rows.filter((row) =>
    fields.some((field) => {
      const value = row?.[field];
      return typeof value === "string" && value.toLowerCase().includes(needle);
    }),
  );
}
