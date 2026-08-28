import { View } from "gpui";
import { v_flex } from "gpui-base";
import { orderBookPanel, timeSalesPanel } from "./ui.js";

export default class DetailUiStatesProbe extends View {
  render(cx) {
    const tokens = cx.theme();
    return v_flex()
      .size_full()
      .gap(tokens.spacing.sm)
      .child(
        orderBookPanel(
          tokens,
          { status: "loading", asks: [], bids: [], error: "" },
          { bid: 0, ask: 0 },
        ),
      )
      .child(
        orderBookPanel(
          tokens,
          { status: "ready", asks: [], bids: [], error: "" },
          { bid: 0, ask: 0 },
        ),
      )
      .child(
        orderBookPanel(
          tokens,
          { status: "error", asks: [], bids: [], error: "Depth entitlement unavailable" },
          { bid: 0, ask: 0 },
        ),
      )
      .child(timeSalesPanel(tokens, { status: "ready", trades: [], error: "" }))
      .child(
        timeSalesPanel(tokens, { status: "error", trades: [], error: "Trade feed unavailable" }),
      );
  }
}
