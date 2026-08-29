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
          {
            status: "ready",
            asks: [{ position: 1, price: null, volume: null }],
            bids: [{ position: 1, price: "", volume: 0n }],
            error: "",
          },
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
      .child(
        timeSalesPanel(tokens, {
          status: "loading",
          trades: [],
          error: "",
        }),
      )
      .child(
        timeSalesPanel(tokens, {
          status: "ready",
          trades: [
            { timestamp: 1_700_000_000n, price: "188.00", volume: 100n, direction: 0 },
            { timestamp: 1_699_999_999n, price: "187.99", volume: 200n, direction: 1 },
          ],
          error: "",
        }),
      )
      .child(timeSalesPanel(tokens, { status: "ready", trades: [], error: "" }))
      .child(
        timeSalesPanel(tokens, { status: "error", trades: [], error: "Trade feed unavailable" }),
      );
  }
}
