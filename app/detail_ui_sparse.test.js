import { View } from "gpui-kit";
import { v_flex } from "gpui-base";
import { orderBookPanel } from "./ui.js";

export default class SparseOrderBookProbe extends View {
  render(cx) {
    const tokens = cx.theme();
    return v_flex()
      .size_full()
      .child(
        orderBookPanel(
          tokens,
          {
            status: "ready",
            asks: [{ position: 1, price: "140.30", volume: 290n, orderNum: 3n }],
            bids: [{ position: 1, price: "140.20", volume: 250n, orderNum: 2n }],
          },
          { bid: 0.46, ask: 0.54 },
        ),
      );
  }
}
