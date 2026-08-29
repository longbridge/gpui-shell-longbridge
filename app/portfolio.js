// Pure portfolio arithmetic. Monetary totals are converted to USD using rates
// supplied by Longbridge; a missing rate is surfaced as unpriced data rather
// than silently relabelling a native-currency amount.

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function signed(value) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}`;
}

function percent(value) {
  return `${signed(value)}%`;
}

/** Normalizes Longbridge exchange rates to USD per one unit of each currency. */
export function normalizeUsdRates(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const data = root.data && typeof root.data === "object" ? root.data : root;
  const exchanges = Array.isArray(data.exchanges) ? data.exchanges : [];
  const rates = new Map([["USD", 1]]);
  for (const item of exchanges) {
    if (!item || typeof item !== "object") continue;
    const base = String(item.base_currency ?? item.baseCurrency ?? "");
    const other = String(item.other_currency ?? item.otherCurrency ?? "");
    const rate = number(item.average_rate ?? item.averageRate);
    if (!(rate > 0)) continue;
    if (base === "USD" && other !== "USD") rates.set(other, rate);
    else if (other === "USD" && base !== "USD") rates.set(base, rate);
  }
  return rates;
}

function usdRate(currency, rates) {
  if (currency === "USD") return 1;
  const rate = rates instanceof Map ? rates.get(currency) : undefined;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * Indexes quotes by symbol, the latest list winning, so a caller that reads the
 * same quotes twice builds the index once instead of concatenating the lists
 * and re-indexing them per reading. Both readings below take the result of this
 * wherever they take an array.
 */
export function quoteIndex(...quoteLists) {
  const bySymbol = new Map();
  for (const quotes of quoteLists) {
    for (const quote of quotes) bySymbol.set(quote.symbol, quote);
  }
  return bySymbol;
}

function indexQuotes(quotes) {
  return quotes instanceof Map ? quotes : quoteIndex(quotes);
}

/** Consolidates priced holding market values in USD. */
export function allocationInUsd(holdings, quotes, rates = new Map([["USD", 1]])) {
  const quotesBySymbol = indexQuotes(quotes);
  const group = { currency: "USD", total: 0, slices: [], unpriced: [] };

  for (const holding of holdings) {
    const quote = quotesBySymbol.get(holding.symbol) ?? {};
    const currency = holding.currency === "--" ? (quote.currency ?? "--") : holding.currency;
    const rate = usdRate(currency, rates);
    const nativeValue = number(holding.quantity) * number(quote.last);
    if (nativeValue > 0 && rate !== null) {
      const value = nativeValue * rate;
      group.total += value;
      group.slices.push({
        symbol: holding.symbol,
        name: holding.name || holding.symbol,
        value,
        percent: 0,
      });
    } else {
      group.unpriced.push({ symbol: holding.symbol, name: holding.name || holding.symbol });
    }
  }

  return {
    ...group,
    slices: group.slices.map((slice) => ({
      ...slice,
      percent: group.total > 0 ? (slice.value / group.total) * 100 : 0,
    })),
  };
}

export function portfolioPresentation(holdings, quotes, rates = new Map([["USD", 1]])) {
  const quotesBySymbol = indexQuotes(quotes);
  const summary = { currency: "USD", todayPnlValue: 0, totalPnlValue: 0 };
  let summaryCount = 0;

  const presented = holdings.map((holding) => {
    const quote = quotesBySymbol.get(holding.symbol) ?? {};
    const quantity = number(holding.quantity);
    const last = number(quote.last);
    const hasQuote = last > 0;
    const previous = number(quote.prevClose);
    const cost = number(holding.costPrice);
    const todayPnl = hasQuote && previous > 0 ? (last - previous) * quantity : 0;
    const totalPnl = hasQuote && cost > 0 ? (last - cost) * quantity : 0;
    const totalCost = cost * quantity;
    const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
    const currency = holding.currency === "--" ? (quote.currency ?? "--") : holding.currency;
    const rate = usdRate(currency, rates);
    if (hasQuote && rate !== null) {
      summary.todayPnlValue += todayPnl * rate;
      summary.totalPnlValue += totalPnl * rate;
      summaryCount += 1;
    }

    return {
      ...holding,
      last: hasQuote ? String(quote.last) : "--",
      todayPnl: hasQuote && previous > 0 && rate !== null ? signed(todayPnl * rate) : "--",
      todayPnlValue: rate === null ? 0 : todayPnl * rate,
      totalPnl: hasQuote && cost > 0 && rate !== null ? signed(totalPnl * rate) : "--",
      totalPnlValue: rate === null ? 0 : totalPnl * rate,
      totalPnlPercent: hasQuote && totalCost > 0 ? percent(totalPnlPercent) : "--",
    };
  });

  return {
    holdings: presented,
    summaries: summaryCount
      ? [
          {
            ...summary,
            todayPnl: signed(summary.todayPnlValue),
            totalPnl: signed(summary.totalPnlValue),
          },
        ]
      : [],
  };
}

/**
 * The ring's geometry, as a share of the box it is painted in.
 *
 * Held here rather than in the drawing, because a wedge is now two things: a
 * path, and an answer to where the pointer is. Both have to agree, and one
 * definition is how they do.
 */
export const ALLOCATION_RING = Object.freeze({ inner: 29, outer: 50, start: -Math.PI / 2 });

/**
 * Which wedge a point falls in, or `null` for none.
 *
 * A wedge cannot be hovered by asking the runtime: every wedge is painted into
 * the same square, so the box a pointer is over is the whole ring and every
 * wedge would report itself at once. What the ring can be asked is where the
 * pointer *is*, and the wedge under it is arithmetic from there -- the same
 * arithmetic the paths are drawn from, which is why the radii and the starting
 * angle are shared rather than repeated.
 *
 * The hole in the middle and everything past the rim are not wedges, which is
 * what makes a ring drawn inside a square hoverable at all.
 *
 * @param {readonly { symbol: string, value: number }[]} slices In drawing order.
 * @param {number} total
 * @param {{ x: number, y: number }} point Element-local, in pixels.
 * @param {{ width: number, height: number }} bounds The ring's own box.
 * @returns {string | null}
 */
export function allocationSliceAt(slices, total, point, bounds) {
  const width = Number(bounds?.width);
  const height = Number(bounds?.height);
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (![width, height, x, y].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  if (!Array.isArray(slices) || slices.length === 0 || !(total > 0)) return null;

  // Percentages of the half-box, which is what the path builder works in.
  const dx = ((x - width / 2) / (width / 2)) * 50;
  const dy = ((y - height / 2) / (height / 2)) * 50;
  const radius = Math.hypot(dx, dy);
  if (radius < ALLOCATION_RING.inner || radius > ALLOCATION_RING.outer) return null;

  const turn = Math.PI * 2;
  let angle = Math.atan2(dy, dx) - ALLOCATION_RING.start;
  angle = ((angle % turn) + turn) % turn;
  const reached = (angle / turn) * total;
  let offset = 0;
  for (const slice of slices) {
    const value = Number(slice?.value);
    if (!Number.isFinite(value) || value <= 0) continue;
    offset += value;
    if (reached < offset) return typeof slice.symbol === "string" ? slice.symbol : null;
  }
  // Rounding at the very end of the last wedge: the pointer is on the ring, so
  // it is on the wedge that closes it.
  const last = [...slices].reverse().find((slice) => Number(slice?.value) > 0);
  return typeof last?.symbol === "string" ? last.symbol : null;
}

/**
 * Ranks an allocation by market value and folds the tail into one "Other"./**
 * Ranks an allocation by market value and folds the tail into one "Other".
 *
 * A donut says which holding a wedge is with color alone, so the palette has to
 * be a fixed set of hues assigned in order — cycling a short list across every
 * position makes color mean nothing and turns the ring into a rainbow. Past
 * `limit` the remainder keeps its size and gives up its identity.
 */
export function foldAllocationSlices(group, limit = 5) {
  const slices = Array.isArray(group?.slices) ? [...group.slices] : [];
  // Largest first in every case, so the ring reads from twelve o'clock down and
  // a wedge keeps the same hue whether or not the tail had to be folded.
  slices.sort((left, right) => right.value - left.value);
  if (slices.length <= limit) return slices.map((slice) => ({ ...slice, other: false }));

  const kept = slices.slice(0, limit).map((slice) => ({ ...slice, other: false }));
  const folded = slices.slice(limit);
  return [
    ...kept,
    {
      symbol: "other",
      name: `Other (${folded.length} positions)`,
      value: folded.reduce((total, slice) => total + slice.value, 0),
      percent: folded.reduce((total, slice) => total + slice.percent, 0),
      other: true,
    },
  ];
}
