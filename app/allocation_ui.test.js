import { View } from "gpui";
import { v_flex } from "gpui-base";
import { allocationChart } from "./ui.js";

// Seven priced positions against five hues: the chart has to fold, and the
// probe exists to show what it folds to.
const group = {
  currency: "USD",
  total: 280,
  unpriced: [{ symbol: "D05.SG", name: "DBS" }],
  slices: [
    { symbol: "C.US", name: "Gamma", value: 40, percent: 14.286 },
    { symbol: "A.US", name: "Alpha", value: 100, percent: 35.714 },
    { symbol: "G.US", name: "Eta", value: 12, percent: 4.286 },
    { symbol: "B.US", name: "Beta", value: 60, percent: 21.429 },
    { symbol: "E.US", name: "Epsilon", value: 20, percent: 7.143 },
    { symbol: "D.US", name: "Delta", value: 30, percent: 10.714 },
    { symbol: "F.US", name: "Zeta", value: 18, percent: 6.429 },
  ],
};

export default class AllocationUiProbe extends View {
  render(cx) {
    return v_flex().child(allocationChart(cx.theme(), group));
  }
}
