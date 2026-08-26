import { text } from "gpui";

import LongbridgeApp from "./main.js";

export default class ChartReconnectProbe extends LongbridgeApp {
  init() {
    this.streamGeneration = 4;
    this.chartGeneration = 9;
    this.stream = {
      start: async () => {},
      // Keep connect parked at its first await. The generation assertion below
      // therefore observes precisely what reconnect invalidates before an old
      // candlestick request can reject from stop().
      stop: () => new Promise(() => {}),
      queryCandlesticks: async () => ({ candlesticks: /** @type {any[]} */ ([]) }),
    };

    void this.connect("replacement-token");
    if (this.chartGeneration !== 10) {
      throw new Error("reconnect did not invalidate the superseded chart request before stop");
    }
  }

  render() {
    return text("ok");
  }
}
