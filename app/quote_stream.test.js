import { View } from "gpui";
import { holdContext } from "./context.js";
import { v_flex } from "gpui-base";
import { COMMAND, FRAME_TYPE, decodeFrame, encodeAuthRequest, encodeFrame } from "./protocol.js";
import { createQuoteStream } from "./quote_stream.js";

const bytes = (...values) => Uint8Array.from(values);

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function sameBytes(actual, expected) {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

class MockTimers {
  constructor() {
    this.intervals = [];
    this.timeouts = [];
  }

  every(delay, callback) {
    const handle = {
      callback,
      delay,
      cancelled: false,
      cancel() {
        this.cancelled = true;
      },
    };
    this.intervals.push(handle);
    return handle;
  }

  after(delay, callback) {
    const handle = {
      callback,
      delay,
      cancelled: false,
      cancel() {
        this.cancelled = true;
      },
    };
    this.timeouts.push(handle);
    return handle;
  }

  fireHeartbeat() {
    for (const timer of this.intervals) if (!timer.cancelled) timer.callback();
  }

  fireReconnect() {
    const timer = this.timeouts.find((candidate) => !candidate.cancelled);
    check(timer && !timer.cancelled, "expected a live reconnect timer");
    timer.callback();
  }

  fireAfter(delay) {
    const timer = this.timeouts.find(
      (candidate) => !candidate.cancelled && candidate.delay === delay,
    );
    check(timer, `expected a live ${delay}ms timer`);
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
    this.writes.push(data);
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

  disconnect(error = new Error("mock connection dropped")) {
    const readers = this.readers.splice(0);
    for (const reader of readers) reader.reject(error);
  }

  async close() {
    this.closed = true;
    this.disconnect(new Error("mock socket closed"));
  }
}

class MockWebSocket {
  constructor(ignoredCommands = []) {
    this.urls = [];
    this.options = [];
    this.sockets = [];
    this.ignoredCommands = new Set(ignoredCommands);
  }

  async connect(url, options) {
    this.urls.push(url);
    this.options.push(options);
    const socket = new MockSocket((packet, peer) => this.respond(packet, peer));
    this.sockets.push(socket);
    return socket;
  }

  respond(packet, socket) {
    check(packet.type === FRAME_TYPE.REQUEST, "stream sends only request packets");
    if (this.ignoredCommands.has(packet.command)) return;
    if (
      packet.command === COMMAND.AUTH ||
      packet.command === COMMAND.SUBSCRIBE ||
      packet.command === COMMAND.REALTIME_QUOTE ||
      packet.command === COMMAND.HISTORY_CANDLESTICKS ||
      packet.command === COMMAND.HEARTBEAT
    ) {
      socket.deliver(
        encodeFrame({
          type: FRAME_TYPE.RESPONSE,
          command: packet.command,
          requestId: packet.requestId,
          status: 0,
          body:
            packet.command === COMMAND.REALTIME_QUOTE
              ? bytes(
                  0x0a,
                  0x25,
                  0x0a,
                  0x07,
                  0x41,
                  0x41,
                  0x50,
                  0x4c,
                  0x2e,
                  0x55,
                  0x53,
                  0x12,
                  0x06,
                  0x31,
                  0x38,
                  0x38,
                  0x2e,
                  0x30,
                  0x30,
                  0x1a,
                  0x06,
                  0x31,
                  0x38,
                  0x30,
                  0x2e,
                  0x30,
                  0x30,
                  0x38,
                  0x80,
                  0xe2,
                  0xcf,
                  0xaa,
                  0x06,
                  0x40,
                  0x80,
                  0x80,
                  0x80,
                  0x80,
                  0x20,
                )
              : packet.command === COMMAND.HISTORY_CANDLESTICKS
                ? bytes(0x0a, 0x07, 0x41, 0x41, 0x50, 0x4c, 0x2e, 0x55, 0x53)
                : bytes(),
        }),
      );
    }
    if (packet.command === COMMAND.SUBSCRIBE) {
      socket.deliver(
        bytes(
          0x03,
          0x65,
          0x00,
          0x00,
          0x1b,
          0x0a,
          0x07,
          0x41,
          0x41,
          0x50,
          0x4c,
          0x2e,
          0x55,
          0x53,
          0x10,
          0x2a,
          0x1a,
          0x06,
          0x31,
          0x38,
          0x39,
          0x2e,
          0x35,
          0x30,
          0x38,
          0x80,
          0xe2,
          0xcf,
          0xaa,
          0x06,
          0x40,
          0x64,
        ),
      );
    }
  }
}

async function runVectors() {
  const transport = new MockWebSocket();
  const timers = new MockTimers();
  const quotes = [];
  const statuses = [];
  const issuedOtps = [];
  const stream = createQuoteStream({
    accessToken: "test-token",
    getOtp: async (accessToken) => {
      check(accessToken === "test-token", "OTP request receives the OAuth access token");
      const otp = `otp-${issuedOtps.length + 1}`;
      issuedOtps.push(otp);
      return otp;
    },
    symbols: ["AAPL.US"],
    onQuote: (quote) => quotes.push(quote),
    onStatus: (status) => statuses.push(status),
    WebSocket: transport,
    timers,
    retryInitialMs: 10,
    retryMaxMs: 40,
  });

  await stream.start();
  await settle();
  const first = transport.sockets[0];
  check(
    transport.urls[0] === "wss://openapi-quote.longbridge.com/v2?version=1&codec=1&platform=9",
    "quote URL includes Longbridge websocket negotiation parameters",
  );
  check(transport.options[0].headers["accept-language"] === "en", "quote language header");
  check(transport.options[0].headers["x-dc-region"] === "ap", "AP token region header");
  check(first.writes.length === 3, "auth, subscribe, then initial quote snapshot writes");
  check(decodeFrame(first.writes[0]).command === COMMAND.AUTH, "auth is first");
  check(
    sameBytes(
      decodeFrame(first.writes[0]).body,
      encodeAuthRequest({ token: "otp-1", metadata: { "accept-language": "en" } }),
    ),
    "websocket auth uses a fresh OTP instead of the OAuth access token",
  );
  check(
    !sameBytes(decodeFrame(first.writes[0]).body, encodeAuthRequest({ token: "otp-1" })),
    "websocket auth carries the English language metadata Longbridge localizes pushes with",
  );
  check(decodeFrame(first.writes[1]).command === COMMAND.SUBSCRIBE, "subscribe follows auth");
  check(
    decodeFrame(first.writes[2]).command === COMMAND.REALTIME_QUOTE,
    "initial snapshot follows subscription",
  );
  check(
    statuses.some((status) => status.state === "connected"),
    "connected status",
  );
  check(
    quotes.some((quote) => quote.symbol === "AAPL.US" && quote.prevClose === "180.00"),
    "snapshot quote callback",
  );
  check(
    quotes.some(
      (quote) =>
        quote.symbol === "AAPL.US" &&
        quote.prevClose === "180.00" &&
        quote.tradeSession === undefined,
    ),
    "snapshot does not invent an authoritative trade session",
  );
  check(
    quotes.some((quote) => quote.symbol === "AAPL.US" && quote.lastDone === "189.50"),
    "push quote callback",
  );

  const history = await stream.queryCandlesticks({
    symbol: "AAPL.US",
    startDate: "20260817",
    endDate: "20260826",
  });
  check(history.symbol === "AAPL.US", "history query returns decoded candlesticks");
  check(
    decodeFrame(first.writes[3]).command === COMMAND.HISTORY_CANDLESTICKS,
    "history query uses command 27",
  );

  timers.fireHeartbeat();
  await settle();
  check(decodeFrame(first.writes[4]).command === COMMAND.HEARTBEAT, "heartbeat write");

  first.disconnect();
  await settle();
  const reconnecting = statuses.find((status) => status.state === "reconnecting");
  check(reconnecting && reconnecting.delay === 10, "first reconnect uses initial backoff");
  timers.fireReconnect();
  await settle();
  const second = transport.sockets[1];
  check(
    second && second.writes.length === 3,
    "reconnect authenticates, subscribes, and refreshes snapshot",
  );
  check(issuedOtps.length === 2, "reconnect requests a fresh one-time password");
  check(
    statuses.filter((status) => status.state === "connected").length === 2,
    "reconnect becomes connected",
  );

  await stream.stop();
  check(second.closed, "stop closes the active socket");
  check(statuses.at(-1).state === "stopped", "stop status");

  const retryTransport = new MockWebSocket();
  const retryTimers = new MockTimers();
  const retrying = createQuoteStream({
    accessToken: "us_test-token",
    getOtp: async () => "retry-otp",
    symbols: ["AAPL.US"],
    WebSocket: retryTransport,
    timers: retryTimers,
    retryInitialMs: 10,
    retryMaxMs: 40,
  });
  await retrying.start();
  check(retryTransport.options[0].headers["x-dc-region"] === "us", "US token region header");
  retryTransport.sockets[0].disconnect();
  await settle();
  const scheduled = retryTimers.timeouts.at(-1);
  check(scheduled && !scheduled.cancelled, "disconnect schedules reconnect");
  await retrying.stop();
  check(scheduled.cancelled, "stop cancels reconnect");
  scheduled.callback();
  await settle();
  check(retryTransport.sockets.length === 1, "cancelled reconnect cannot open a socket");

  const silentTransport = new MockWebSocket([COMMAND.AUTH]);
  const silentTimers = new MockTimers();
  const silentStatuses = [];
  let timeoutError = null;
  const silent = createQuoteStream({
    accessToken: "test-token",
    getOtp: async () => "silent-otp",
    symbols: ["AAPL.US"],
    onStatus: (status) => silentStatuses.push(status),
    WebSocket: silentTransport,
    timers: silentTimers,
    timeoutMillis: 5_000,
    retryInitialMs: 10,
    retryMaxMs: 40,
  });
  const starting = silent.start().catch((error) => {
    timeoutError = error;
  });
  await settle();
  silentTimers.fireAfter(5_000);
  await settle();
  await starting;
  check(
    timeoutError && timeoutError.message.includes("timed out"),
    "silent auth request rejects at the client timeout",
  );
  check(
    silentStatuses.some((status) => status.state === "reconnecting"),
    "silent auth schedules reconnect",
  );
  await silent.stop();
}

export default class QuoteStreamVectorProbe extends View {
  init(_props, cx) {
    holdContext(cx);
    this.result = "pending";
    cx.spawn(async (cx) => {
      try {
        // Yield through the shell scheduler so the test runs from the same
        // task continuation as a real view's asynchronous connection setup.
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
