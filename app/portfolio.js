// Pure portfolio arithmetic. Values stay grouped by native currency so the
// presentation never adds unlike monetary units.

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

export function portfolioPresentation(holdings, quotes) {
  const quotesBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
  const summariesByCurrency = new Map();

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
    if (hasQuote) {
      const summary = summariesByCurrency.get(currency) ?? {
        currency,
        todayPnlValue: 0,
        totalPnlValue: 0,
      };
      summary.todayPnlValue += todayPnl;
      summary.totalPnlValue += totalPnl;
      summariesByCurrency.set(currency, summary);
    }

    return {
      ...holding,
      last: hasQuote ? String(quote.last) : "--",
      todayPnl: hasQuote && previous > 0 ? signed(todayPnl) : "--",
      todayPnlValue: todayPnl,
      totalPnl: hasQuote && cost > 0 ? signed(totalPnl) : "--",
      totalPnlValue: totalPnl,
      totalPnlPercent: hasQuote && totalCost > 0 ? percent(totalPnlPercent) : "--",
    };
  });

  return {
    holdings: presented,
    summaries: [...summariesByCurrency.values()].map((summary) => ({
      currency: summary.currency,
      todayPnl: signed(summary.todayPnlValue),
      todayPnlValue: summary.todayPnlValue,
      totalPnl: signed(summary.totalPnlValue),
      totalPnlValue: summary.totalPnlValue,
    })),
  };
}
