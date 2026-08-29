// Everything about changing the watchlist that is not a request: which groups
// an account has, which of them an added security should go into, which ones a
// removed security has to come out of, and what a typed symbol has to look
// like before any of that is worth asking the API.
//
// The reading side stays in `market.js`. This is the editing side, and it is
// pure for the same reason that one is: what the application does to a
// watchlist should be decidable without a socket.

/**
 * Longbridge answers two kinds of group.
 *
 * The ones an account made have positive ids; the ones the terminal
 * synthesizes -- `holdings`, which is the portfolio seen as a list -- have
 * negative ones. A synthetic group is a view of something else, so it is not
 * somewhere a security can be put or taken out of.
 *
 * @param {unknown} value
 */
function editableGroupId(value) {
  const id = String(value ?? "").trim();
  return id !== "" && !id.startsWith("-") ? id : null;
}

/**
 * The account's editable groups, each with the symbols it holds.
 *
 * @param {unknown} payload The `/v1/watchlist/groups` answer.
 */
export function watchlistGroups(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const data = root.data && typeof root.data === "object" ? root.data : root;
  const groups = Array.isArray(data.groups) ? data.groups : [];
  return Object.freeze(
    groups
      .map((group) => {
        const id = editableGroupId(group?.id);
        if (id === null) return null;
        const securities = Array.isArray(group.securities) ? group.securities : [];
        return Object.freeze({
          id,
          name: typeof group.name === "string" ? group.name : id,
          symbols: Object.freeze(
            securities
              .map((security) => (typeof security?.symbol === "string" ? security.symbol : null))
              .filter((symbol) => symbol !== null),
          ),
        });
      })
      .filter((group) => group !== null),
  );
}

/**
 * Where an added security goes: the first group the account has.
 *
 * The API takes a group rather than a watchlist -- there is no "the
 * watchlist" to add to -- and the first group is the one Longbridge itself
 * treats as the whole list. This client draws every group's securities as one
 * list, so adding to that first group is adding to what is on screen.
 *
 * @param {ReturnType<typeof watchlistGroups>} groups
 */
export function addTargetGroup(groups) {
  return (Array.isArray(groups) ? groups : [])[0] ?? null;
}

/**
 * Every group a security has to come out of.
 *
 * One security can sit in several groups -- the whole list and a market's own
 * group -- and taking it out of one of them leaves it on screen, put there by
 * the other.
 *
 * @param {ReturnType<typeof watchlistGroups>} groups
 * @param {string} symbol
 */
export function groupsHolding(groups, symbol) {
  const wanted = String(symbol ?? "");
  if (wanted === "") return Object.freeze([]);
  return Object.freeze(
    (Array.isArray(groups) ? groups : []).filter((group) => group.symbols.includes(wanted)),
  );
}

/**
 * A group's id as the update endpoint wants it.
 *
 * The list answers ids as strings and the update takes an integer, so a
 * numeric id is sent as one. A group whose id is not a number is sent as it
 * arrived rather than as `NaN`.
 *
 * @param {{ id: string }} group
 */
export function groupRequestId(group) {
  const id = String(group?.id ?? "");
  return /^-?\d+$/.test(id) ? Number(id) : id;
}

/**
 * What a typed symbol has to look like: a code, a dot, and the market it
 * trades in.
 *
 * The market is not guessed. `AAPL` is a US security and `700` a Hong Kong
 * one only to a reader who already knows; to this application they are half a
 * symbol, and half a symbol added to a watchlist is either a rejection from
 * the API or, worse, the wrong security silently added.
 *
 * @param {unknown} value What was typed.
 * @returns {{ symbol: string, error: string }}
 */
export function symbolFromInput(value) {
  const typed = String(value ?? "")
    .trim()
    .toUpperCase();
  if (typed === "") return { symbol: "", error: "Type a symbol." };
  if (!typed.includes(".")) {
    return { symbol: "", error: "Include the market, as in AAPL.US or 700.HK." };
  }
  if (!/^[A-Z0-9]+(-[A-Z0-9]+)?\.[A-Z]{2,4}$/.test(typed)) {
    return { symbol: "", error: `${typed} is not a Longbridge symbol.` };
  }
  return { symbol: typed, error: "" };
}
