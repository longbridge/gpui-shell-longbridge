import { View } from "gpui";
import {
  addTargetGroup,
  groupRequestId,
  groupsHolding,
  symbolFromInput,
  watchlistGroups,
} from "./watchlist_edit.js";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const PAYLOAD = Object.freeze({
  code: 0,
  data: {
    groups: [
      {
        id: "2630",
        name: "all",
        securities: [
          { symbol: "AAPL.US", market: "US", name: "Apple" },
          { symbol: "700.HK", market: "HK", name: "Tencent" },
        ],
      },
      { id: "-6", name: "holdings", securities: [{ symbol: "NVDA.US" }] },
      { id: "2628", name: "us", securities: [{ symbol: "AAPL.US" }, { symbol: null }] },
      { id: "", name: "nameless", securities: [] },
    ],
  },
});

function runVectors() {
  const groups = watchlistGroups(PAYLOAD);
  check(
    groups.map((group) => group.id).join(",") === "2630,2628",
    "a synthetic group is not somewhere a security can be put",
  );
  check(groups[0].name === "all" && groups[1].name === "us", "groups keep their own names");
  check(
    groups[1].symbols.join(",") === "AAPL.US",
    "a security without a symbol is not a member of anything",
  );
  check(Object.isFrozen(groups) && Object.isFrozen(groups[0].symbols), "groups are immutable");
  check(watchlistGroups(undefined).length === 0, "an unusable payload is an empty list");

  check(
    addTargetGroup(groups).id === "2630",
    "an added security goes into the account's first group",
  );
  check(addTargetGroup([]) === null, "an account with no group has nowhere to add to");

  check(
    groupsHolding(groups, "AAPL.US")
      .map((group) => group.id)
      .join(",") === "2630,2628",
    "a security comes out of every group that holds it",
  );
  check(
    groupsHolding(groups, "TSLA.US").length === 0,
    "a security nothing holds comes out of nothing",
  );
  check(groupsHolding(groups, "").length === 0, "no symbol is not every symbol");

  check(groupRequestId(groups[0]) === 2630, "a numeric group id is sent as the number it is");
  check(
    groupRequestId({ id: "classic" }) === "classic",
    "a group id that is not a number is not NaN",
  );

  check(
    symbolFromInput(" aapl.us ").symbol === "AAPL.US",
    "a typed symbol is trimmed and upper case",
  );
  check(symbolFromInput("700.HK").symbol === "700.HK", "a numeric code is a code");
  check(symbolFromInput("BABA-W.HK").symbol === "BABA-W.HK", "a suffixed code keeps its suffix");
  check(symbolFromInput("").error === "Type a symbol.", "an empty field says what to do");
  check(
    symbolFromInput("AAPL").error.includes("Include the market"),
    "the market is asked for rather than guessed",
  );
  check(
    symbolFromInput("AAPL").symbol === "",
    "half a symbol is not passed on to the API as a whole one",
  );
  check(
    symbolFromInput("A A.US").error === "A A.US is not a Longbridge symbol.",
    "a symbol that cannot be one says so in its own words",
  );
}

runVectors();

export default class WatchlistEditVectorProbe extends View {
  render() {
    return { type: "text", text: "ok" };
  }
}
