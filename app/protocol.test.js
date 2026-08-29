// This is an application-module test vector, not a Node test.  The Rust test
// loads it through gpui-shell's QuickJS runtime, so the `zlib` import exercises
// the same standard-runtime surface as the real application.

import { View } from "gpui";
import { gzipSync } from "zlib";
import {
  COMMAND,
  FRAME_TYPE,
  PERIOD,
  TRADE_SESSION,
  decodeFrame,
  decodeSecurityCandlestickResponse,
  decodeSecurityIntradayResponse,
  decodePushQuote,
  decodeSecurityQuoteResponse,
  decodeSecurityStaticInfoResponse,
  encodeAuthRequest,
  encodeFrame,
  encodeHeartbeat,
  encodeIntradayRequest,
  encodeSecurityCandlestickRequest,
  encodeHistoryCandlestickDateRequest,
  encodeRealtimeQuoteRequest,
  encodeSubscribeRequest,
} from "./protocol.js";
import * as depthTradesProtocol from "./protocol.js";

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

  // These vectors catch missing codecs and a swapped, omitted, or incorrectly
  // typed protobuf field in the depth and time-and-sales wire contracts.
  check(
    typeof depthTradesProtocol.encodeUnsubscribeRequest === "function" &&
      typeof depthTradesProtocol.encodeSecurityRequest === "function" &&
      typeof depthTradesProtocol.encodeSecurityTradeRequest === "function" &&
      typeof depthTradesProtocol.decodeSecurityDepthResponse === "function" &&
      typeof depthTradesProtocol.decodeSecurityTradeResponse === "function" &&
      typeof depthTradesProtocol.decodePushDepth === "function" &&
      typeof depthTradesProtocol.decodePushTrade === "function",
    "depth and trade codec exports",
  );
  check(
    depthTradesProtocol.COMMAND.DEPTH === 14 &&
      depthTradesProtocol.COMMAND.TRADES === 17 &&
      depthTradesProtocol.COMMAND.PUSH_DEPTH === 102 &&
      depthTradesProtocol.COMMAND.PUSH_TRADE === 104,
    "depth and trade command values",
  );
  checkBytes(
    depthTradesProtocol.encodeUnsubscribeRequest({
      symbols: ["AAPL.US"],
      subTypes: [2, 4],
    }),
    // Unsubscribe shares SubscribeRequest's symbol and packed sub_type fields.
    bytes(0x0a, 0x07, 0x41, 0x41, 0x50, 0x4c, 0x2e, 0x55, 0x53, 0x12, 0x02, 0x02, 0x04),
    "unsubscribe protobuf",
  );
  checkBytes(
    depthTradesProtocol.encodeSecurityRequest("AAPL.US"),
    bytes(0x0a, 0x07, 0x41, 0x41, 0x50, 0x4c, 0x2e, 0x55, 0x53),
    "security request protobuf",
  );
  checkBytes(
    depthTradesProtocol.encodeSecurityTradeRequest({ symbol: "AAPL.US", count: 20 }),
    bytes(0x0a, 0x07, 0x41, 0x41, 0x50, 0x4c, 0x2e, 0x55, 0x53, 0x10, 0x14),
    "security trade request protobuf",
  );

  const depthResponse = depthTradesProtocol.decodeSecurityDepthResponse(
    bytes(
      0x0a,
      0x06,
      0x37,
      0x30,
      0x30,
      0x2e,
      0x48,
      0x4b,
      // ask: position=1, omitted price, volume=-5, order_num=7, unknown field 9.
      0x12,
      0x11,
      0x08,
      0x01,
      0x18,
      0xfb,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0x01,
      0x20,
      0x07,
      0x48,
      0x01,
      // bid: position=2, price=189.50, volume=100, order_num=3.
      0x1a,
      0x0e,
      0x08,
      0x02,
      0x12,
      0x06,
      0x31,
      0x38,
      0x39,
      0x2e,
      0x35,
      0x30,
      0x18,
      0x64,
      0x20,
      0x03,
      // Unknown top-level field 15.
      0x78,
      0x01,
    ),
  );
  check(
    depthResponse.symbol === "700.HK" &&
      depthResponse.asks.length === 1 &&
      depthResponse.asks[0].position === 1 &&
      depthResponse.asks[0].price === undefined &&
      depthResponse.asks[0].volume === -5n &&
      depthResponse.asks[0].orderNum === 7n &&
      depthResponse.bids.length === 1 &&
      depthResponse.bids[0].position === 2 &&
      depthResponse.bids[0].price === "189.50" &&
      depthResponse.bids[0].volume === 100n &&
      depthResponse.bids[0].orderNum === 3n,
    "SecurityDepthResponse protobuf",
  );

  const trade = bytes(
    0x0a,
    0x06,
    0x31,
    0x38,
    0x39,
    0x2e,
    0x35,
    0x30,
    0x10,
    0xfe,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0x01,
    0x18,
    0x80,
    0xe2,
    0xcf,
    0xaa,
    0x06,
    0x22,
    0x01,
    0x49,
    0x28,
    0x02,
    0x30,
    0x02,
    // Unknown fixed32 field 7.
    0x3d,
    0x01,
    0x00,
    0x00,
    0x00,
  );
  const tradeResponse = depthTradesProtocol.decodeSecurityTradeResponse(
    bytes(0x0a, 0x07, 0x41, 0x41, 0x50, 0x4c, 0x2e, 0x55, 0x53, 0x12, 0x25, ...trade, 0x38, 0x01),
  );
  check(
    tradeResponse.symbol === "AAPL.US" &&
      tradeResponse.trades.length === 1 &&
      tradeResponse.trades[0].price === "189.50" &&
      tradeResponse.trades[0].volume === -2n &&
      tradeResponse.trades[0].timestamp === 1_700_000_000n &&
      tradeResponse.trades[0].tradeType === "I" &&
      tradeResponse.trades[0].direction === 2 &&
      tradeResponse.trades[0].tradeSession === 2,
    "SecurityTradeResponse protobuf",
  );
  const depthPush = depthTradesProtocol.decodePushDepth(
    bytes(
      0x0a,
      0x06,
      0x37,
      0x30,
      0x30,
      0x2e,
      0x48,
      0x4b,
      0x10,
      0x2a,
      0x1a,
      0x11,
      0x08,
      0x01,
      0x18,
      0xfb,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0x01,
      0x20,
      0x07,
      0x48,
      0x01,
      0x22,
      0x0e,
      0x08,
      0x02,
      0x12,
      0x06,
      0x31,
      0x38,
      0x39,
      0x2e,
      0x35,
      0x30,
      0x18,
      0x64,
      0x20,
      0x03,
    ),
  );
  check(
    depthPush.symbol === "700.HK" &&
      depthPush.sequence === 42n &&
      depthPush.asks[0].price === undefined &&
      depthPush.bids[0].price === "189.50",
    "PushDepth protobuf",
  );
  const tradePush = depthTradesProtocol.decodePushTrade(
    bytes(0x0a, 0x07, 0x41, 0x41, 0x50, 0x4c, 0x2e, 0x55, 0x53, 0x10, 0x2a, 0x1a, 0x25, ...trade),
  );
  check(
    tradePush.symbol === "AAPL.US" &&
      tradePush.sequence === 42n &&
      tradePush.trades[0].tradeType === "I" &&
      tradePush.trades[0].direction === 2 &&
      tradePush.trades[0].tradeSession === 2,
    "PushTrade protobuf",
  );

  check(COMMAND.HISTORY_CANDLESTICKS === 27, "history candlestick command");
  check(
    COMMAND.INTRADAY === 18 && COMMAND.CANDLESTICKS === 19,
    "intraday and current candlestick command values",
  );
  check(
    PERIOD.ONE_MINUTE === 1 &&
      PERIOD.FIVE_MINUTE === 5 &&
      PERIOD.FIFTEEN_MINUTE === 15 &&
      PERIOD.DAY === 1000,
    "chart period values",
  );
  check(
    TRADE_SESSION.NORMAL === 0 &&
      TRADE_SESSION.PRE === 1 &&
      TRADE_SESSION.POST === 2 &&
      TRADE_SESSION.OVERNIGHT === 3 &&
      TRADE_SESSION.ALL === 100,
    "chart trade session values",
  );
  checkBytes(
    encodeIntradayRequest({ symbol: "AAPL.US", tradeSession: TRADE_SESSION.ALL }),
    bytes(0x0a, 0x07, 0x41, 0x41, 0x50, 0x4c, 0x2e, 0x55, 0x53, 0x10, 0x64),
    "intraday request protobuf",
  );
  checkBytes(
    encodeSecurityCandlestickRequest({
      symbol: "AAPL.US",
      period: PERIOD.FIFTEEN_MINUTE,
      count: 120,
      tradeSession: TRADE_SESSION.ALL,
    }),
    bytes(0x0a, 0x07, 0x41, 0x41, 0x50, 0x4c, 0x2e, 0x55, 0x53, 0x10, 0x0f, 0x18, 0x78, 0x28, 0x64),
    "current candlestick period and session protobuf",
  );
  checkBytes(
    encodeHistoryCandlestickDateRequest({
      symbol: "AAPL.US",
      startDate: "20260817",
      endDate: "20260826",
      period: PERIOD.DAY,
      tradeSession: TRADE_SESSION.ALL,
    }),
    // SecurityHistoryCandlestickRequest: symbol=1, day period=2,
    // query-by-date=4, DateQuery=6, trade session=7. Proto3 no-adjust is
    // omitted.
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
      0xe8,
      0x07,
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
      0x38,
      0x64,
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

  const intraday = decodeSecurityIntradayResponse(
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
      // Line is canonical: price/timestamp/volume/turnover/avg_price. Field
      // 6 is unknown to this response and must be skipped, not reinterpreted
      // as a session supplied by the server.
      0x12,
      0x20,
      0x0a,
      0x0a,
      0x31,
      0x38,
      0x39,
      0x2e,
      0x31,
      0x32,
      0x33,
      0x34,
      0x35,
      0x36,
      0x10,
      0x80,
      0xe2,
      0xcf,
      0xaa,
      0x06,
      0x18,
      0x64,
      0x22,
      0x03,
      0x31,
      0x32,
      0x33,
      0x2a,
      0x03,
      0x31,
      0x38,
      0x39,
      0x30,
      0x03,
    ),
  );
  check(
    intraday.symbol === "AAPL.US" &&
      intraday.lines.length === 1 &&
      intraday.lines[0].price === "189.123456" &&
      intraday.lines[0].turnover === "123" &&
      intraday.lines[0].avgPrice === "189" &&
      intraday.lines[0].volume === 100n &&
      intraday.lines[0].tradeSession === undefined,
    "SecurityIntradayResponse keeps canonical fields and skips unknown field 6",
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

  // SecurityStaticInfoResponse, field for field as `quote/api.proto` numbers
  // them: what the add-a-security preview reads is the name and the exchange,
  // and reading either from the wrong field number would put a listing date
  // where a company name goes.
  const [staticInfo] = decodeSecurityStaticInfoResponse(
    bytes(
      0x0a,
      0x48,
      0x0a,
      0x05,
      0x4b,
      0x4f,
      0x2e,
      0x55,
      0x53,
      0x12,
      0x0a,
      0x4b,
      0x65,
      0x6b,
      0x6f,
      0x75,
      0x20,
      0x4b,
      0x65,
      0x6c,
      0x65,
      0x1a,
      0x09,
      0x43,
      0x6f,
      0x63,
      0x61,
      0x2d,
      0x43,
      0x6f,
      0x6c,
      0x61,
      0x22,
      0x09,
      0x43,
      0x6f,
      0x63,
      0x61,
      0x2d,
      0x43,
      0x6f,
      0x6c,
      0x61,
      0x2a,
      0x0a,
      0x31,
      0x39,
      0x31,
      0x39,
      0x2d,
      0x30,
      0x39,
      0x2d,
      0x30,
      0x35,
      0x32,
      0x04,
      0x4e,
      0x59,
      0x53,
      0x45,
      0x3a,
      0x03,
      0x55,
      0x53,
      0x44,
      0x40,
      0x01,
      0x48,
      0x80,
      0x96,
      0xb3,
      0x82,
      0x10,
    ),
  );
  check(
    staticInfo.symbol === "KO.US" &&
      staticInfo.nameCn === "Kekou Kele" &&
      staticInfo.nameEn === "Coca-Cola" &&
      staticInfo.nameHk === "Coca-Cola" &&
      staticInfo.listingDate === "1919-09-05" &&
      staticInfo.exchange === "NYSE" &&
      staticInfo.currency === "USD" &&
      staticInfo.lotSize === 1,
    "SecurityStaticInfo protobuf",
  );
  check(
    staticInfo.totalShares === undefined,
    "a field the preview does not read is skipped rather than misread",
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
