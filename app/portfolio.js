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

/** Consolidates priced holding market values in USD. */
export function allocationInUsd(holdings, quotes, rates = new Map([["USD", 1]])) {
  const quotesBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
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
  const quotesBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
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
