// This is an application-module test vector, not a Node test.  The Rust test
// loads it through gpui-shell's QuickJS runtime, so the `zlib` import exercises
// the same standard-runtime surface as the real application.

import { View } from "gpui";
import { gzipSync } from "zlib";
import {
  COMMAND,
  FRAME_TYPE,
  decodeFrame,
  decodeSecurityCandlestickResponse,
  decodePushQuote,
  decodeSecurityQuoteResponse,
  encodeAuthRequest,
  encodeFrame,
  encodeHeartbeat,
  encodeHistoryCandlestickDateRequest,
  encodeRealtimeQuoteRequest,
  encodeSubscribeRequest,
} from "./protocol.js";

const bytes = (...values) => Uint8Array.from(values);

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function checkBytes(actual, expected, message) {
  check(actual instanceof Uint8Array, `${message}: result is not Uint8Array`);
  check(
    actual.length === expected.length,
    `${message}: length ${actual.length} != ${expected.length}`,
  );
  for (let index = 0; index < actual.length; index += 1) {
    check(actual[index] === expected[index], `${message}: byte ${index}`);
  }
}

function checkThrows(operation, needle) {
  try {
    operation();
  } catch (error) {
    check(String(error).toLowerCase().includes(needle), `expected ${needle}, got ${error}`);
    return;
  }
  throw new Error(`expected failure containing ${needle}`);
}

function runVectors() {
  const authBody = encodeAuthRequest({ token: "abc" });
  const auth = encodeFrame({
    type: FRAME_TYPE.REQUEST,
    command: COMMAND.AUTH,
    requestId: 0x01020304,
    timeoutMillis: 5000,
    body: authBody,
  });
  // wsclient/codec.rs: type, command, BE u32 request id, BE u16 timeout,
  // BE u24 body length, followed by the protobuf body.
  checkBytes(
    auth,
    bytes(
      0x01,
      0x02,
      0x01,
      0x02,
      0x03,
      0x04,
      0x13,
      0x88,
      0x00,
      0x00,
      0x05,
      0x0a,
      0x03,
      0x61,
      0x62,
      0x63,
    ),
    "auth request frame",
  );

  const heartbeatBody = encodeHeartbeat({ timestamp: 1_700_000_000_000n, heartbeatId: 7 });
  const request = decodeFrame(
    encodeFrame({
      type: FRAME_TYPE.REQUEST,
      command: COMMAND.HEARTBEAT,
      requestId: 9,
      timeoutMillis: 1000,
      body: heartbeatBody,
    }),
  );
  check(request.requestId === 9 && request.timeoutMillis === 1000, "request round trip");
  checkBytes(request.body, heartbeatBody, "request body round trip");

  const response = decodeFrame(
    encodeFrame({
      type: FRAME_TYPE.RESPONSE,
      command: COMMAND.SUBSCRIBE,
      requestId: 9,
      status: 0,
      body: bytes(),
    }),
  );
  check(
    response.type === FRAME_TYPE.RESPONSE && response.status === 0 && response.requestId === 9,
    "response round trip",
  );
  const push = decodeFrame(
    encodeFrame({
      type: FRAME_TYPE.PUSH,
      command: COMMAND.PUSH_QUOTE,
      body: bytes(0x0a, 0x07, 0x41, 0x41, 0x50, 0x4c, 0x2e, 0x55, 0x53),
    }),
  );
  check(push.type === FRAME_TYPE.PUSH && push.command === COMMAND.PUSH_QUOTE, "push round trip");

  checkBytes(
    encodeSubscribeRequest({ symbols: ["700.HK"], subTypes: [1], isFirstPush: true }),
    // quote/api.proto SubscribeRequest: repeated string=1, packed enum=2, bool=3.
    bytes(0x0a, 0x06, 0x37, 0x30, 0x30, 0x2e, 0x48, 0x4b, 0x12, 0x01, 0x01, 0x18, 0x01),
    "subscribe protobuf",
  );
  checkBytes(
    encodeRealtimeQuoteRequest(["AAPL.US", "700.HK"]),
    // quote/api.proto MultiSecurityRequest: repeated string symbol=1.
    bytes(
      0x0a,
      0x07,
      0x41,
      0x41,
      0x50,
      0x4c,
      0x2e,
      0x55,
      0x53,
      0x0a,
      0x06,
      0x37,
      0x30,
      0x30,
      0x2e,
      0x48,
      0x4b,
    ),
    "realtime quote protobuf",
  );

  check(COMMAND.HISTORY_CANDLESTICKS === 27, "history candlestick command");
  checkBytes(
    encodeHistoryCandlestickDateRequest({
      symbol: "AAPL.US",
      startDate: "20260817",
      endDate: "20260826",
    }),
    // SecurityHistoryCandlestickRequest: symbol=1, one-minute period=2,
    // query-by-date=4, DateQuery=6, intraday trade session=7. Proto3 zero
    // values (no-adjust and intraday) are omitted.
    bytes(
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
      0x01,
      0x20,
      0x02,
      0x32,
      0x14,
      0x0a,
      0x08,
      0x32,
      0x30,
      0x32,
      0x36,
      0x30,
      0x38,
      0x31,
      0x37,
      0x12,
      0x08,
      0x32,
      0x30,
      0x32,
      0x36,
      0x30,
      0x38,
      0x32,
      0x36,
    ),
    "history candlestick date query protobuf",
  );

  const history = decodeSecurityCandlestickResponse(
    bytes(
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
      0x28,
      0x0a,
      0x06,
      0x31,
      0x38,
      0x39,
      0x2e,
      0x35,
      0x30,
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
      0x37,
      0x2e,
      0x30,
      0x30,
      0x22,
      0x06,
      0x31,
      0x39,
      0x30,
      0x2e,
      0x30,
      0x30,
      0x28,
      0x64,
      0x38,
      0x80,
      0xe2,
      0xcf,
      0xaa,
      0x06,
    ),
  );
  check(
    history.symbol === "AAPL.US" &&
      history.candlesticks.length === 1 &&
      history.candlesticks[0].close === "189.50" &&
      history.candlesticks[0].open === "188.00" &&
      history.candlesticks[0].low === "187.00" &&
      history.candlesticks[0].high === "190.00" &&
      history.candlesticks[0].volume === 100n &&
      history.candlesticks[0].timestamp === 1_700_000_000n &&
      history.candlesticks[0].tradeSession === 0,
    "SecurityCandlestickResponse protobuf",
  );

  const pushFrame = bytes(
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
  );
  const quotePush = decodePushQuote(decodeFrame(pushFrame).body);
  check(
    quotePush.symbol === "AAPL.US" &&
      quotePush.sequence === 42n &&
      quotePush.lastDone === "189.50" &&
      quotePush.timestamp === 1_700_000_000n &&
      quotePush.volume === 100n,
    "PushQuote protobuf",
  );

  const quoteResponse = decodeSecurityQuoteResponse(
    bytes(
      0x0a,
      0x1d,
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
      0x80,
      0x80,
      0x80,
      0x80,
      0x20,
    ),
  );
  check(
    quoteResponse.length === 1 &&
      quoteResponse[0].symbol === "AAPL.US" &&
      quoteResponse[0].timestamp === 1_700_000_000n &&
      quoteResponse[0].volume === 8_589_934_592n,
    "SecurityQuoteResponse protobuf",
  );

  checkThrows(() => decodeFrame(bytes(0x01)), "truncated");
  checkThrows(() => decodeFrame(bytes(0x03, 0x65, 0x00, 0x00, 0x02, 0x0a)), "length");
  const body = bytes(0x0a, 0x07, 0x41, 0x41, 0x50, 0x4c, 0x2e, 0x55, 0x53);
  const compressed = gzipSync(body);
  const compressedFrame = new Uint8Array(5 + compressed.length);
  compressedFrame.set(bytes(0x23, 0x65, 0x00, 0x00, compressed.length), 0);
  compressedFrame.set(compressed, 5);
  checkBytes(decodeFrame(compressedFrame).body, body, "gzip frame");
}

runVectors();

export default class ProtocolVectorProbe extends View {}
