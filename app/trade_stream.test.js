// The trade gateway's push channel, driven against a socket that is not one.
//
// What has to hold is the handshake -- authenticate, then subscribe to the one
// topic, and only then call itself connected -- and the reading of a push: the
// private topic carries more than orders, so the channel has to recognise the
// one it is for and let the rest past without treating it as a fault.

import { View } from "gpui";
import { holdContext } from "./context.js";
import { v_flex } from "gpui-base";
import {
  FRAME_TYPE,
  TRADE_COMMAND,
  TRADE_CONTENT_JSON,
  decodeFrame,
  decodeTradeNotification,
  encodeFrame,
} from "./protocol.js";
import { ORDER_CHANGED_EVENT, createTradeStream, orderFromNotification } from "./trade_stream.js";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

/** Encodes a trade.Notification the way the gateway does. */
function notification(topic, json) {
  const utf8 = (value) => {
    const out = [];
    for (const character of value) {
      const code = character.codePointAt(0);
      if (code <= 0x7f) out.push(code);
      else if (code <= 0x7ff) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      else out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
    return out;
  };
  const topicBytes = utf8(topic);
  const dataBytes = utf8(JSON.stringify(json));
  return Uint8Array.from([
    0x0a,
    topicBytes.length,
    ...topicBytes,
    0x10,
    TRADE_CONTENT_JSON,
    0x18,
    1,
    0x22,
    ...(dataBytes.length < 0x80
      ? [dataBytes.length]
      : [(dataBytes.length & 0x7f) | 0x80, dataBytes.length >> 7]),
    ...dataBytes,
  ]);
}

class MockTimers {
  constructor() {
    this.intervals = [];
    this.timeouts = [];
  }

  every(delay, callback) {
    const handle = { callback, delay, cancelled: false };
    this.intervals.push(handle);
    return handle;
  }

  after(delay, callback) {
    const handle = { callback, delay, cancelled: false };
    this.timeouts.push(handle);
    return handle;
  }

  cancel(handle) {
    if (handle) handle.cancelled = true;
  }

  fireReconnect() {
    const timer = this.timeouts.find((candidate) => !candidate.cancelled);
    check(timer, "expected a live reconnect timer");
    timer.callback();
  }
}

class MockSocket {
  constructor(onWrite) {
    this.onWrite = onWrite;
    this.writes = [];
    this.messages = [];
    this.readers = [];
    this.closed = false;
  }

  async write(data) {
    this.writes.push(decodeFrame(data));
    this.onWrite(decodeFrame(data), this);
  }

  read() {
    if (this.messages.length) return Promise.resolve(this.messages.shift());
    return new Promise((resolve, reject) => this.readers.push({ resolve, reject }));
  }

  deliver(data) {
    const reader = this.readers.shift();
    if (reader) reader.resolve(data);
    else this.messages.push(data);
  }

  async close() {
    this.closed = true;
    const readers = this.readers.splice(0);
    for (const reader of readers) reader.reject(new Error("mock socket closed"));
  }
}

class MockWebSocket {
  constructor(failCommands = new Map()) {
    this.urls = [];
    this.options = [];
    this.sockets = [];
    this.failCommands = failCommands;
  }

  async connect(url, options) {
    this.urls.push(url);
    this.options.push(options);
    const socket = new MockSocket((packet, peer) => {
      check(packet.type === FRAME_TYPE.REQUEST, "the stream sends only requests");
      peer.deliver(
        encodeFrame({
          type: FRAME_TYPE.RESPONSE,
          command: packet.command,
          requestId: packet.requestId,
          status: this.failCommands.get(packet.command) ?? 0,
          body: new Uint8Array(),
        }),
      );
    });
    this.sockets.push(socket);
    return socket;
  }
}

async function runVectors() {
  // A notification is read for the one thing this channel is for. An order is
  // recognised by its id; an asset change on the same topic is not an order,
  // and neither is a payload that is not JSON at all.
  const payload = (json) => decodeTradeNotification(notification("private", json));
  const change = (data) => payload({ event: ORDER_CHANGED_EVENT, data });
  check(
    orderFromNotification(change({ order_id: "701" }))?.order_id === "701",
    "an order change is read out of its envelope",
  );
  check(
    orderFromNotification(payload({ event: "gridtrading_order", data: { order_id: "702" } })) ===
      null,
    "a grid master order shares the topic and is not one of these",
  );
  check(
    orderFromNotification(payload({ event: "asset_changed", data: { currency: "USD" } })) === null,
    "and neither is an asset change",
  );
  check(
    orderFromNotification(
      decodeTradeNotification(
        notification("quote", { event: ORDER_CHANGED_EVENT, data: { order_id: "703" } }),
      ),
    ) === null,
    "nor anything arriving on a topic this channel did not subscribe to",
  );
  check(
    orderFromNotification({ topic: "private", contentType: 2, data: Uint8Array.of(1, 2, 3) }) ===
      null,
    "nor a body this channel cannot read",
  );

  const transport = new MockWebSocket();
  const timers = new MockTimers();
  const orders = [];
  const statuses = [];
  const stream = createTradeStream({
    accessToken: "test-token",
    getOtp: async () => "trade-otp",
    onOrder: (order) => orders.push(order),
    onStatus: (status, detail) => statuses.push({ status, detail }),
    WebSocket: transport,
    timers,
  });

  stream.start();
  await settle();

  check(transport.urls.length === 1, "the stream opens exactly one socket");
  check(
    transport.urls[0].startsWith("wss://openapi-trade.longbridge.com/"),
    `the trade gateway is its own host: ${transport.urls[0]}`,
  );
  check(
    transport.options[0].headers["x-dc-region"] === "ap",
    "the handshake carries the region the token belongs to",
  );

  const commands = transport.sockets[0].writes.map((packet) => packet.command);
  check(
    commands[0] === TRADE_COMMAND.AUTH && commands[1] === TRADE_COMMAND.SUBSCRIBE,
    `authentication precedes subscription: ${commands.join(",")}`,
  );
  check(
    statuses.at(-1).status === "connected",
    `a completed handshake reports connected: ${statuses.map((entry) => entry.status).join(",")}`,
  );
  check(stream.isConnected(), "and says so when asked");

  // The order arrives because the gateway sent it, not because it was asked
  // for. This is the whole point of the channel.
  transport.sockets[0].deliver(
    encodeFrame({
      type: FRAME_TYPE.PUSH,
      command: TRADE_COMMAND.PUSH_NOTIFICATION,
      body: notification("private", {
        event: ORDER_CHANGED_EVENT,
        data: {
          order_id: "701",
          symbol: "AAPL.US",
          status: "New",
          side: "Buy",
          submitted_quantity: "10",
          submitted_price: "180.000",
        },
      }),
    }),
  );
  await settle();
  check(orders.length === 1, `a pushed order reaches the application: ${orders.length}`);
  check(orders[0].order_id === "701", "and arrives with the fields the order endpoints use");
  check(orders[0].symbol === "AAPL.US", "including the instrument it is for");
  check(
    orders[0].submitted_quantity === "10",
    "and in the gateway's own words, for `orders.js` to translate",
  );

  // An asset change shares the topic. It is not an order, and not a fault.
  transport.sockets[0].deliver(
    encodeFrame({
      type: FRAME_TYPE.PUSH,
      command: TRADE_COMMAND.PUSH_NOTIFICATION,
      body: notification("private", {
        event: "asset_changed",
        data: { currency: "USD", total_cash: "1000" },
      }),
    }),
  );
  await settle();
  check(orders.length === 1, "an asset change is not mistaken for an order");
  check(stream.isConnected(), "and does not take the connection down");

  // A subscription the gateway refuses is a failure, not a silent success --
  // a stream that believes it is subscribed and is not will never say that
  // orders have stopped arriving.
  const refusing = new MockWebSocket(new Map([[TRADE_COMMAND.SUBSCRIBE, 3]]));
  const refusedTimers = new MockTimers();
  const refusedStatuses = [];
  const refused = createTradeStream({
    accessToken: "test-token",
    getOtp: async () => "trade-otp",
    onOrder: () => {},
    onStatus: (status) => refusedStatuses.push(status),
    WebSocket: refusing,
    timers: refusedTimers,
  });
  refused.start();
  await settle();
  check(
    refusedStatuses.at(-1) === "reconnecting",
    `a refused subscription reconnects rather than reporting success: ${refusedStatuses.join(",")}`,
  );
  check(!refused.isConnected(), "and does not claim to be connected");
  check(refusing.sockets[0].closed, "the half-open session is closed");
  refused.stop();

  // Stopping is final: a session that has been stopped does not reconnect.
  stream.stop();
  check(!stream.isConnected(), "a stopped stream reports itself disconnected");
  check(transport.sockets[0].closed, "and closes its socket");
}

export default class TradeStreamVectorProbe extends View {
  init(_props, cx) {
    holdContext(cx);
    this.result = "pending";
    cx.spawn(async (cx) => {
      try {
        await cx.sleep(0);
        await runVectors();
        this.result = "ok";
      } catch (error) {
        this.result = `failed:${error.message}`;
      }
      cx.notify();
    });
  }

  render() {
    return v_flex().child(this.result);
  }
}
