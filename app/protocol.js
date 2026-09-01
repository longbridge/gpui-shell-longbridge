// Minimal Longbridge quote WebSocket wire codec.  This intentionally has no
// socket, credential, HTTP, or trading code: callers only exchange Uint8Array
// WebSocket binary messages with it.
//
// Wire layout and command values are verified against the pinned OpenAPI
// source used by ../longbridge-terminal:
//   rust/crates/wsclient/src/codec.rs
//   rust/crates/proto/openapi-protobufs/control/control.proto
//   rust/crates/proto/openapi-protobufs/quote/api.proto

import { gunzipSync } from "zlib";

const MAX_BODY_LENGTH = 0x00ff_ffff;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const SIGNATURE_LENGTH = 24;

export const FRAME_TYPE = Object.freeze({
  REQUEST: 1,
  RESPONSE: 2,
  PUSH: 3,
});

export const COMMAND = Object.freeze({
  HEARTBEAT: 1,
  AUTH: 2,
  SUBSCRIBE: 6,
  UNSUBSCRIBE: 7,
  STATIC_INFO: 10,
  REALTIME_QUOTE: 11,
  DEPTH: 14,
  TRADES: 17,
  INTRADAY: 18,
  CANDLESTICKS: 19,
  HISTORY_CANDLESTICKS: 27,
  PUSH_QUOTE: 101,
  PUSH_DEPTH: 102,
  PUSH_TRADE: 104,
});

/**
 * The commands the *trade* gateway speaks.
 *
 * A separate table because the two gateways number their commands
 * independently: 18 is an intraday request to the quote socket and a push
 * notification on this one. They share the frame, the authentication and the
 * heartbeat, and nothing else.
 */
export const TRADE_COMMAND = Object.freeze({
  HEARTBEAT: 1,
  AUTH: 2,
  SUBSCRIBE: 16,
  UNSUBSCRIBE: 17,
  PUSH_NOTIFICATION: 18,
});

/** The topic carrying this account's own orders and assets. */
export const TRADE_TOPIC_PRIVATE = "private";

export const SUB_TYPE = Object.freeze({
  QUOTE: 1,
  DEPTH: 2,
  BROKERS: 3,
  TRADE: 4,
});

export const PERIOD = Object.freeze({
  ONE_MINUTE: 1,
  FIVE_MINUTE: 5,
  FIFTEEN_MINUTE: 15,
  DAY: 1000,
});

export const TRADE_SESSION = Object.freeze({
  NORMAL: 0,
  PRE: 1,
  POST: 2,
  OVERNIGHT: 3,
  ALL: 100,
});

export class LongbridgeProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "LongbridgeProtocolError";
  }
}

function fail(message) {
  throw new LongbridgeProtocolError(message);
}

function requireBytes(value, name) {
  if (!(value instanceof Uint8Array)) fail(`${name} must be a Uint8Array`);
  return value;
}

function requireInteger(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function requireString(value, name) {
  if (typeof value !== "string") fail(`${name} must be a string`);
  return value;
}

function requireEnum(value, name, values) {
  if (!Object.values(values).includes(value)) fail(`${name} is not supported`);
  return value;
}

function concat(parts) {
  let length = 0;
  for (const part of parts) length += part.length;
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function encodeUtf8(value, name) {
  requireString(value, name);
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) fail(`${name} contains an unpaired surrogate`);
    if (codePoint > 0xffff) index += 1;

    if (codePoint <= 0x7f) {
      result.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      result.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      result.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      result.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(result);
}

/**
 * UTF-8 bytes to a string.
 *
 * Exported because this runtime has no `TextDecoder`, and a caller holding
 * bytes off a frame -- a JSON notification body, say -- has nowhere else to
 * turn.
 */
export function decodeUtf8(bytes, name) {
  const chars = [];
  for (let offset = 0; offset < bytes.length;) {
    const first = bytes[offset++];
    if (first <= 0x7f) {
      chars.push(String.fromCharCode(first));
      continue;
    }
    const width =
      first >= 0xc2 && first <= 0xdf
        ? 2
        : first >= 0xe0 && first <= 0xef
          ? 3
          : first >= 0xf0 && first <= 0xf4
            ? 4
            : 0;
    if (width === 0 || offset + width - 1 > bytes.length)
      fail(`protobuf ${name} is not valid UTF-8`);
    let codePoint = first & (width === 2 ? 0x1f : width === 3 ? 0x0f : 0x07);
    for (let index = 1; index < width; index += 1) {
      const next = bytes[offset++];
      if ((next & 0xc0) !== 0x80) fail(`protobuf ${name} is not valid UTF-8`);
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    if (
      (width === 2 && codePoint < 0x80) ||
      (width === 3 && (codePoint < 0x800 || (codePoint >= 0xd800 && codePoint <= 0xdfff))) ||
      (width === 4 && (codePoint < 0x10000 || codePoint > 0x10ffff))
    )
      fail(`protobuf ${name} is not valid UTF-8`);
    if (codePoint <= 0xffff) {
      chars.push(String.fromCharCode(codePoint));
    } else {
      const pair = codePoint - 0x10000;
      chars.push(String.fromCharCode(0xd800 | (pair >> 10), 0xdc00 | (pair & 0x3ff)));
    }
  }
  return chars.join("");
}

function u24(value) {
  return Uint8Array.of((value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function u32(value) {
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

function u16(value) {
  return Uint8Array.of((value >>> 8) & 0xff, value & 0xff);
}

function readU24(bytes, offset) {
  return (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
}

function readU32(bytes, offset) {
  return (
    bytes[offset] * 0x1_000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

/**
 * Encodes one Longbridge binary packet.  The protocol does not use a total
 * frame length; the per-type fixed header plus its u24 body length is exact.
 */
export function encodeFrame(packet) {
  if (!packet || typeof packet !== "object") fail("packet must be an object");
  const type = requireInteger(packet.type, "packet.type", 1, 3);
  const command = requireInteger(packet.command, "packet.command", 0, 0xff);
  const body = requireBytes(packet.body ?? new Uint8Array(), "packet.body");
  if (body.length > MAX_BODY_LENGTH) fail("packet.body exceeds the u24 wire limit");

  if (type === FRAME_TYPE.REQUEST) {
    const requestId = requireInteger(packet.requestId, "packet.requestId", 0, 0xffff_ffff);
    const timeoutMillis = requireInteger(packet.timeoutMillis, "packet.timeoutMillis", 0, 0xffff);
    return concat([
      Uint8Array.of(type, command),
      u32(requestId),
      u16(timeoutMillis),
      u24(body.length),
      body,
    ]);
  }

  if (type === FRAME_TYPE.RESPONSE) {
    const requestId = requireInteger(packet.requestId, "packet.requestId", 0, 0xffff_ffff);
    const status = requireInteger(packet.status, "packet.status", 0, 0xff);
    return concat([
      Uint8Array.of(type, command),
      u32(requestId),
      Uint8Array.of(status),
      u24(body.length),
      body,
    ]);
  }

  return concat([Uint8Array.of(type, command), u24(body.length), body]);
}

/** Decodes and length-checks one binary WebSocket message. */
export function decodeFrame(data) {
  const bytes = requireBytes(data, "data");
  if (bytes.length < 1) fail("truncated frame header");

  const header = bytes[0];
  if ((header & 0xc0) !== 0) fail("frame header has reserved bits set");
  const gzip = (header & 0x20) !== 0;
  const type = header & 0x0f;
  const verified = (header & 0x10) !== 0;
  if (type < FRAME_TYPE.REQUEST || type > FRAME_TYPE.PUSH) fail("unknown frame type");

  const signatureLength = verified ? SIGNATURE_LENGTH : 0;
  let offset = 1;
  const requireRemaining = (length, label) => {
    if (bytes.length - offset < length) fail(`truncated ${label}`);
  };
  requireRemaining(1, "command");
  const command = bytes[offset++];

  let requestId;
  let timeoutMillis;
  let status;
  if (type === FRAME_TYPE.REQUEST) {
    requireRemaining(9, "request header");
    requestId = readU32(bytes, offset);
    timeoutMillis = (bytes[offset + 4] << 8) | bytes[offset + 5];
    offset += 6;
  } else if (type === FRAME_TYPE.RESPONSE) {
    requireRemaining(8, "response header");
    requestId = readU32(bytes, offset);
    status = bytes[offset + 4];
    offset += 5;
  } else {
    requireRemaining(3, "push header");
  }

  const bodyLength = readU24(bytes, offset);
  offset += 3;
  const expectedLength = offset + bodyLength + signatureLength;
  if (expectedLength !== bytes.length) {
    fail(
      `frame length mismatch: header declares ${expectedLength} bytes, received ${bytes.length}`,
    );
  }
  let body = bytes.slice(offset, offset + bodyLength);
  offset += bodyLength;
  const signature = verified
    ? { nonce: bytes.slice(offset, offset + 8), signature: bytes.slice(offset + 8, offset + 24) }
    : null;

  if (gzip) {
    try {
      body = new Uint8Array(gunzipSync(body));
    } catch {
      fail("invalid gzip-compressed frame body");
    }
    if (body.length > MAX_BODY_LENGTH) fail("inflated frame body exceeds the u24 wire limit");
  }

  if (type === FRAME_TYPE.REQUEST) {
    return { type, command, requestId, timeoutMillis, body, signature };
  }
  if (type === FRAME_TYPE.RESPONSE) {
    return { type, command, requestId, status, body, signature };
  }
  return { type, command, body, signature };
}

function asBigInt(value, name, signed = false) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail(`${name} must be a safe integer or bigint`);
    value = BigInt(value);
  }
  if (typeof value !== "bigint") fail(`${name} must be a bigint or safe integer`);
  const minimum = signed ? -(1n << 63n) : 0n;
  const maximum = signed ? (1n << 63n) - 1n : (1n << 64n) - 1n;
  if (value < minimum || value > maximum) fail(`${name} is outside its 64-bit range`);
  return value;
}

function encodeVarint(value, name = "varint") {
  let current = asBigInt(value, name);
  const encoded = [];
  do {
    let byte = Number(current & 0x7fn);
    current >>= 7n;
    if (current !== 0n) byte |= 0x80;
    encoded.push(byte);
  } while (current !== 0n);
  return Uint8Array.from(encoded);
}

function encodeSignedInt64(value, name) {
  return encodeVarint(BigInt.asUintN(64, asBigInt(value, name, true)), name);
}

function fieldTag(field, wireType) {
  return encodeVarint(
    BigInt(requireInteger(field, "field", 1, 0x1fff_ffff) * 8 + wireType),
    "field tag",
  );
}

function stringField(field, value, name) {
  const encoded = encodeUtf8(value, name);
  return concat([
    fieldTag(field, 2),
    encodeVarint(BigInt(encoded.length), "string length"),
    encoded,
  ]);
}

function bytesField(field, value) {
  const bytes = requireBytes(value, "protobuf bytes");
  return concat([fieldTag(field, 2), encodeVarint(BigInt(bytes.length), "bytes length"), bytes]);
}

function varintField(field, value, name, signed = false) {
  return concat([
    fieldTag(field, 0),
    signed ? encodeSignedInt64(value, name) : encodeVarint(value, name),
  ]);
}

function packedVarintField(field, values, name) {
  if (!Array.isArray(values)) fail(`${name} must be an array`);
  const packed = concat(
    values.map((value, index) =>
      encodeVarint(
        BigInt(requireInteger(value, `${name}[${index}]`, 0, 0xffff_ffff)),
        `${name}[${index}]`,
      ),
    ),
  );
  return packed.length === 0 ? new Uint8Array() : bytesField(field, packed);
}

/** Encodes control.AuthRequest for command 2. */
export function encodeAuthRequest({ token, metadata = {} }) {
  const parts = [stringField(1, token, "token")];
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    fail("metadata must be an object");
  }
  for (const key of Object.keys(metadata).sort()) {
    const entry = concat([
      stringField(1, key, "metadata key"),
      stringField(2, metadata[key], `metadata.${key}`),
    ]);
    parts.push(bytesField(2, entry));
  }
  return concat(parts);
}

/** Encodes control.Heartbeat for command 1. */
export function encodeHeartbeat({ timestamp, heartbeatId } = {}) {
  const parts = [];
  if (timestamp !== undefined) parts.push(varintField(1, timestamp, "timestamp", true));
  if (heartbeatId !== undefined) {
    parts.push(
      varintField(
        2,
        BigInt(requireInteger(heartbeatId, "heartbeatId", -0x8000_0000, 0x7fff_ffff)),
        "heartbeatId",
        true,
      ),
    );
  }
  return concat(parts);
}

/** Encodes quote.SubscribeRequest for command 6. */
export function encodeSubscribeRequest({
  symbols,
  subTypes = [SUB_TYPE.QUOTE],
  isFirstPush = true,
}) {
  if (!Array.isArray(symbols)) fail("symbols must be an array");
  const parts = symbols.map((symbol, index) => stringField(1, symbol, `symbols[${index}]`));
  parts.push(packedVarintField(2, subTypes, "subTypes"));
  if (isFirstPush) parts.push(varintField(3, 1n, "isFirstPush"));
  return concat(parts);
}

/** Encodes quote.UnsubscribeRequest's compatible subscription fields for command 7. */
export function encodeUnsubscribeRequest(options) {
  return encodeSubscribeRequest({ ...options, isFirstPush: false });
}

/**
 * Encodes trade.Sub for command 16, and trade.Unsub for 17.
 *
 * One repeated string field, which is the whole message. The topic names are
 * the gateway's -- `private` is this account's own orders and assets.
 *
 * @param {readonly string[]} topics
 */
export function encodeTradeSubscribeRequest(topics) {
  if (!Array.isArray(topics) || topics.length === 0) fail("topics must be a non-empty array");
  return concat(topics.map((topic, index) => stringField(1, topic, `topics[${index}]`)));
}

/**
 * Decodes trade.SubResponse, the answer to a subscribe.
 *
 * The command succeeds and the topics are reported one by one: `success`,
 * `fail` with a reason, and `current` for what is subscribed now. A status of
 * zero therefore says the gateway understood the request, not that it granted
 * it -- so a caller that only checks the status can believe it is subscribed
 * to a topic it was refused, and then wait forever for pushes that were never
 * going to come.
 */
export function decodeTradeSubscribeResponse(data) {
  const response = { success: [], fail: [], current: [] };
  decodeMessage(data, (reader, field, wireType) => {
    if (field === 1) {
      expectWireType(wireType, 2, field);
      response.success.push(reader.readString("subscribe success"));
    } else if (field === 2) {
      expectWireType(wireType, 2, field);
      const failure = { topic: "", reason: "" };
      decodeMessage(reader.readBytes("subscribe fail"), (inner, innerField, innerWire) => {
        if (innerField === 1) {
          expectWireType(innerWire, 2, innerField);
          failure.topic = inner.readString("subscribe fail topic");
        } else if (innerField === 2) {
          expectWireType(innerWire, 2, innerField);
          failure.reason = inner.readString("subscribe fail reason");
        } else return false;
        return true;
      });
      response.fail.push(failure);
    } else if (field === 3) {
      expectWireType(wireType, 2, field);
      response.current.push(reader.readString("subscribe current"));
    } else return false;
    return true;
  });
  return response;
}

/**
 * Decodes trade.Notification, which arrives as command 18.
 *
 * The payload is opaque at this layer: `contentType` says whether `data` is
 * JSON or protobuf, and what is inside depends on the topic. Reading it is the
 * caller's, because this module knows frames and the caller knows orders.
 */
export function decodeTradeNotification(data) {
  const notification = { topic: "", contentType: 0, dispatchType: 0, data: new Uint8Array() };
  decodeMessage(data, (reader, field, wireType) => {
    if (field === 1) {
      expectWireType(wireType, 2, field);
      notification.topic = reader.readString("notification topic");
    } else if (field === 2) {
      expectWireType(wireType, 0, field);
      notification.contentType = Number(reader.readVarint("notification content_type"));
    } else if (field === 3) {
      expectWireType(wireType, 0, field);
      notification.dispatchType = Number(reader.readVarint("notification dispatch_type"));
    } else if (field === 4) {
      expectWireType(wireType, 2, field);
      notification.data = reader.readBytes("notification data");
    } else return false;
    return true;
  });
  return notification;
}

/**
 * What a notification says its `data` is: `ContentType` from the push
 * definition, where 0 is `CONTENT_UNDEFINED`.
 *
 * The gateway sends 0 on the `private` topic and JSON in the body regardless,
 * which is why the SDK reads that body on the strength of the topic alone.
 * Both values are named here because the useful question is not "is this
 * JSON?" but "has it said it is *not*?".
 */
export const TRADE_CONTENT_JSON = 1;
export const TRADE_CONTENT_PROTOBUF = 2;

/** Encodes quote.SecurityRequest, used by the depth command. */
export function encodeSecurityRequest(symbol) {
  return stringField(1, symbol, "symbol");
}

/** Encodes quote.SecurityTradeRequest for command 17. */
export function encodeSecurityTradeRequest({ symbol, count }) {
  return concat([
    stringField(1, symbol, "symbol"),
    varintField(
      2,
      BigInt(requireInteger(count, "count", -0x8000_0000, 0x7fff_ffff)),
      "count",
      true,
    ),
  ]);
}

/** Encodes quote.MultiSecurityRequest for real-time quote command 11. */
export function encodeRealtimeQuoteRequest(symbols) {
  if (!Array.isArray(symbols)) fail("symbols must be an array");
  return concat(symbols.map((symbol, index) => stringField(1, symbol, `symbols[${index}]`)));
}

function requireCompactDate(value, name) {
  requireString(value, name);
  if (!/^\d{8}$/.test(value)) fail(`${name} must use YYYYMMDD format`);
  return value;
}

/**
 * Encodes quote.SecurityIntradayRequest (command 18). The trade-session
 * field is retained for newer Longbridge servers while a normal-session
 * request remains wire-compatible with the one-field legacy request.
 */
export function encodeIntradayRequest({ symbol, tradeSession = TRADE_SESSION.NORMAL }) {
  requireEnum(tradeSession, "tradeSession", TRADE_SESSION);
  const parts = [stringField(1, symbol, "symbol")];
  if (tradeSession !== TRADE_SESSION.NORMAL) {
    parts.push(varintField(2, BigInt(tradeSession), "tradeSession"));
  }
  return concat(parts);
}

/** Encodes quote.SecurityCandlestickRequest for command 19. */
export function encodeSecurityCandlestickRequest({
  symbol,
  period = PERIOD.ONE_MINUTE,
  count = 120,
  tradeSession = TRADE_SESSION.NORMAL,
}) {
  requireEnum(period, "period", PERIOD);
  requireEnum(tradeSession, "tradeSession", TRADE_SESSION);
  return concat([
    stringField(1, symbol, "symbol"),
    varintField(2, BigInt(period), "period"),
    varintField(3, BigInt(requireInteger(count, "count", 1, 1000)), "count"),
    ...(tradeSession === TRADE_SESSION.NORMAL
      ? []
      : [varintField(5, BigInt(tradeSession), "tradeSession")]),
  ]);
}

/**
 * Encodes quote.SecurityHistoryCandlestickRequest for a no-adjust query by
 * date (command 27).
 */
export function encodeHistoryCandlestickDateRequest({
  symbol,
  startDate,
  endDate,
  period = PERIOD.ONE_MINUTE,
  tradeSession = TRADE_SESSION.NORMAL,
}) {
  requireEnum(period, "period", PERIOD);
  requireEnum(tradeSession, "tradeSession", TRADE_SESSION);
  const dateQuery = concat([
    stringField(1, requireCompactDate(startDate, "startDate"), "startDate"),
    stringField(2, requireCompactDate(endDate, "endDate"), "endDate"),
  ]);
  return concat([
    stringField(1, symbol, "symbol"),
    varintField(2, BigInt(period), "period"),
    varintField(4, 2n, "queryType"),
    bytesField(6, dateQuery),
    ...(tradeSession === TRADE_SESSION.NORMAL
      ? []
      : [varintField(7, BigInt(tradeSession), "tradeSession")]),
  ]);
}

class ProtoReader {
  constructor(bytes) {
    this.bytes = requireBytes(bytes, "protobuf data");
    this.offset = 0;
  }

  readByte(label) {
    if (this.offset >= this.bytes.length) fail(`truncated protobuf ${label}`);
    return this.bytes[this.offset++];
  }

  readVarint(label) {
    let value = 0n;
    for (let index = 0; index < 10; index += 1) {
      const byte = this.readByte(label);
      if (index === 9 && byte > 1) fail(`protobuf ${label} exceeds 64 bits`);
      value |= BigInt(byte & 0x7f) << BigInt(index * 7);
      if ((byte & 0x80) === 0) return value;
    }
    fail(`protobuf ${label} is an unterminated varint`);
  }

  readLength(label) {
    const length = this.readVarint(`${label} length`);
    if (length > MAX_SAFE_BIGINT) fail(`protobuf ${label} length exceeds JavaScript limits`);
    const numericLength = Number(length);
    if (numericLength > this.bytes.length - this.offset) fail(`truncated protobuf ${label}`);
    return numericLength;
  }

  readBytes(label) {
    const length = this.readLength(label);
    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readString(label) {
    return decodeUtf8(this.readBytes(label), label);
  }

  readField() {
    const tag = this.readVarint("field tag");
    if (tag > MAX_SAFE_BIGINT) fail("protobuf field tag exceeds JavaScript limits");
    const numericTag = Number(tag);
    const field = numericTag >>> 3;
    const wireType = numericTag & 7;
    if (field === 0) fail("protobuf field number must be non-zero");
    return { field, wireType };
  }

  skip(wireType) {
    if (wireType === 0) {
      this.readVarint("unknown field");
    } else if (wireType === 1) {
      if (this.bytes.length - this.offset < 8) fail("truncated protobuf fixed64 field");
      this.offset += 8;
    } else if (wireType === 2) {
      this.readBytes("unknown field");
    } else if (wireType === 5) {
      if (this.bytes.length - this.offset < 4) fail("truncated protobuf fixed32 field");
      this.offset += 4;
    } else {
      fail(`unsupported protobuf wire type ${wireType}`);
    }
  }
}

function expectWireType(actual, expected, field) {
  if (actual !== expected)
    fail(`protobuf field ${field} has wire type ${actual}, expected ${expected}`);
}

function signed64(value) {
  return BigInt.asIntN(64, value);
}

function unsigned32(value, field) {
  if (value > 0xffff_ffffn) fail(`protobuf ${field} exceeds uint32`);
  return Number(value);
}

function signed32(value, field) {
  const result = signed64(value);
  if (result < -0x8000_0000n || result > 0x7fff_ffffn) {
    fail(`protobuf ${field} exceeds int32`);
  }
  return Number(result);
}

function decodeMessage(data, readField) {
  const reader = new ProtoReader(data);
  while (reader.offset < reader.bytes.length) {
    const { field, wireType } = reader.readField();
    if (!readField(reader, field, wireType)) reader.skip(wireType);
  }
}

function decodePrePostQuote(data) {
  const quote = {};
  decodeMessage(data, (reader, field, wireType) => {
    if (field === 1) {
      expectWireType(wireType, 2, field);
      quote.lastDone = reader.readString("pre/post last_done");
    } else if (field === 2) {
      expectWireType(wireType, 0, field);
      quote.timestamp = signed64(reader.readVarint("pre/post timestamp"));
    } else if (field === 3) {
      expectWireType(wireType, 0, field);
      quote.volume = signed64(reader.readVarint("pre/post volume"));
    } else if (field === 4) {
      expectWireType(wireType, 2, field);
      quote.turnover = reader.readString("pre/post turnover");
    } else if (field === 5) {
      expectWireType(wireType, 2, field);
      quote.high = reader.readString("pre/post high");
    } else if (field === 6) {
      expectWireType(wireType, 2, field);
      quote.low = reader.readString("pre/post low");
    } else if (field === 7) {
      expectWireType(wireType, 2, field);
      quote.prevClose = reader.readString("pre/post prev_close");
    } else return false;
    return true;
  });
  return quote;
}

function decodeSecurityQuote(data) {
  const quote = {};
  decodeMessage(data, (reader, field, wireType) => {
    if (field >= 1 && field <= 6) {
      expectWireType(wireType, 2, field);
      const names = ["symbol", "lastDone", "prevClose", "open", "high", "low"];
      quote[names[field - 1]] = reader.readString(`quote ${names[field - 1]}`);
    } else if (field === 7) {
      expectWireType(wireType, 0, field);
      quote.timestamp = signed64(reader.readVarint("quote timestamp"));
    } else if (field === 8) {
      expectWireType(wireType, 0, field);
      quote.volume = signed64(reader.readVarint("quote volume"));
    } else if (field === 9) {
      expectWireType(wireType, 2, field);
      quote.turnover = reader.readString("quote turnover");
    } else if (field === 10) {
      expectWireType(wireType, 0, field);
      quote.tradeStatus = unsigned32(reader.readVarint("quote trade_status"), "trade_status");
    } else if (field === 11) {
      expectWireType(wireType, 2, field);
      quote.preMarketQuote = decodePrePostQuote(reader.readBytes("pre_market_quote"));
    } else if (field === 12) {
      expectWireType(wireType, 2, field);
      quote.postMarketQuote = decodePrePostQuote(reader.readBytes("post_market_quote"));
    } else if (field === 13) {
      expectWireType(wireType, 2, field);
      quote.overnightQuote = decodePrePostQuote(reader.readBytes("over_night_quote"));
    } else return false;
    return true;
  });
  return quote;
}

/**
 * Decodes one quote.StaticInfo.
 *
 * Only the fields that say which security this is are read; the rest of the
 * message -- share counts, per-share figures, what derivatives exist -- is
 * skipped, which is what an unrecognized field number costs here anyway.
 */
function decodeStaticInfo(data) {
  const info = {};
  decodeMessage(data, (reader, field, wireType) => {
    if (field >= 1 && field <= 7) {
      expectWireType(wireType, 2, field);
      const names = ["symbol", "nameCn", "nameEn", "nameHk", "listingDate", "exchange", "currency"];
      info[names[field - 1]] = reader.readString(`static ${names[field - 1]}`);
    } else if (field === 8) {
      expectWireType(wireType, 0, field);
      info.lotSize = signed32(reader.readVarint("static lot_size"), "static lot_size");
    } else return false;
    return true;
  });
  return info;
}

/** Decodes quote.SecurityStaticInfoResponse returned by command 10. */
export function decodeSecurityStaticInfoResponse(data) {
  const infos = [];
  decodeMessage(data, (reader, field, wireType) => {
    if (field !== 1) return false;
    expectWireType(wireType, 2, field);
    infos.push(decodeStaticInfo(reader.readBytes("secu_static_info")));
    return true;
  });
  return infos;
}

/** Decodes quote.SecurityQuoteResponse returned by command 11. */
export function decodeSecurityQuoteResponse(data) {
  const quotes = [];
  decodeMessage(data, (reader, field, wireType) => {
    if (field !== 1) return false;
    expectWireType(wireType, 2, field);
    quotes.push(decodeSecurityQuote(reader.readBytes("secu_quote")));
    return true;
  });
  return quotes;
}

function decodeDepth(data) {
  const depth = {};
  decodeMessage(data, (reader, field, wireType) => {
    if (field === 1) {
      expectWireType(wireType, 0, field);
      depth.position = signed32(reader.readVarint("depth position"), "depth position");
    } else if (field === 2) {
      expectWireType(wireType, 2, field);
      depth.price = reader.readString("depth price");
    } else if (field === 3 || field === 4) {
      expectWireType(wireType, 0, field);
      const name = field === 3 ? "volume" : "orderNum";
      depth[name] = signed64(reader.readVarint(`depth ${name}`));
    } else return false;
    return true;
  });
  return depth;
}

function decodeSecurityDepth(data, push) {
  const response = { asks: [], bids: [] };
  decodeMessage(data, (reader, field, wireType) => {
    if (field === 1) {
      expectWireType(wireType, 2, field);
      response.symbol = reader.readString("depth symbol");
    } else if (push && field === 2) {
      expectWireType(wireType, 0, field);
      response.sequence = signed64(reader.readVarint("depth sequence"));
    } else if (field === (push ? 3 : 2) || field === (push ? 4 : 3)) {
      expectWireType(wireType, 2, field);
      response[field === (push ? 3 : 2) ? "asks" : "bids"].push(
        decodeDepth(reader.readBytes("depth level")),
      );
    } else return false;
    return true;
  });
  return response;
}

/** Decodes quote.SecurityDepthResponse returned by command 14. */
export function decodeSecurityDepthResponse(data) {
  return decodeSecurityDepth(data, false);
}

/** Decodes quote.PushDepth delivered by push command 102. */
export function decodePushDepth(data) {
  return decodeSecurityDepth(data, true);
}

function decodeTrade(data) {
  const trade = {};
  decodeMessage(data, (reader, field, wireType) => {
    if (field === 1 || field === 4) {
      expectWireType(wireType, 2, field);
      const name = field === 1 ? "price" : "tradeType";
      trade[name] = reader.readString(`trade ${name}`);
    } else if (field === 2 || field === 3) {
      expectWireType(wireType, 0, field);
      const name = field === 2 ? "volume" : "timestamp";
      trade[name] = signed64(reader.readVarint(`trade ${name}`));
    } else if (field === 5) {
      expectWireType(wireType, 0, field);
      trade.direction = signed32(reader.readVarint("trade direction"), "trade direction");
    } else if (field === 6) {
      expectWireType(wireType, 0, field);
      trade.tradeSession = unsigned32(reader.readVarint("trade trade_session"), "trade_session");
    } else return false;
    return true;
  });
  return trade;
}

function decodeSecurityTrade(data, push) {
  const response = { trades: [] };
  decodeMessage(data, (reader, field, wireType) => {
    if (field === 1) {
      expectWireType(wireType, 2, field);
      response.symbol = reader.readString("trade symbol");
    } else if (push && field === 2) {
      expectWireType(wireType, 0, field);
      response.sequence = signed64(reader.readVarint("trade sequence"));
    } else if (field === (push ? 3 : 2)) {
      expectWireType(wireType, 2, field);
      response.trades.push(decodeTrade(reader.readBytes("trade")));
    } else return false;
    return true;
  });
  return response;
}

/** Decodes quote.SecurityTradeResponse returned by command 17. */
export function decodeSecurityTradeResponse(data) {
  return decodeSecurityTrade(data, false);
}

/** Decodes quote.PushTrade delivered by push command 104. */
export function decodePushTrade(data) {
  return decodeSecurityTrade(data, true);
}

function decodeCandlestick(data) {
  const candlestick = { tradeSession: 0 };
  decodeMessage(data, (reader, field, wireType) => {
    if (field >= 1 && field <= 4) {
      expectWireType(wireType, 2, field);
      const names = ["close", "open", "low", "high"];
      candlestick[names[field - 1]] = reader.readString(`candlestick ${names[field - 1]}`);
    } else if (field === 5 || field === 7) {
      expectWireType(wireType, 0, field);
      const name = field === 5 ? "volume" : "timestamp";
      candlestick[name] = signed64(reader.readVarint(`candlestick ${name}`));
    } else if (field === 6) {
      expectWireType(wireType, 2, field);
      candlestick.turnover = reader.readString("candlestick turnover");
    } else if (field === 8) {
      expectWireType(wireType, 0, field);
      candlestick.tradeSession = unsigned32(
        reader.readVarint("candlestick trade_session"),
        "trade_session",
      );
    } else return false;
    return true;
  });
  return candlestick;
}

function decodeIntradayLine(data) {
  const line = {};
  decodeMessage(data, (reader, field, wireType) => {
    if (field === 1 || field === 4 || field === 5) {
      expectWireType(wireType, 2, field);
      const names = { 1: "price", 4: "turnover", 5: "avgPrice" };
      line[names[field]] = reader.readString(`intraday ${names[field]}`);
    } else if (field === 2 || field === 3) {
      expectWireType(wireType, 0, field);
      const name = field === 2 ? "timestamp" : "volume";
      line[name] = signed64(reader.readVarint(`intraday ${name}`));
    } else return false;
    return true;
  });
  return line;
}

/** Decodes quote.SecurityIntradayResponse returned by command 18. */
export function decodeSecurityIntradayResponse(data) {
  const response = { lines: [] };
  decodeMessage(data, (reader, field, wireType) => {
    if (field === 1) {
      expectWireType(wireType, 2, field);
      response.symbol = reader.readString("intraday response symbol");
    } else if (field === 2) {
      expectWireType(wireType, 2, field);
      response.lines.push(decodeIntradayLine(reader.readBytes("intraday line")));
    } else return false;
    return true;
  });
  return response;
}

/** Decodes quote.SecurityCandlestickResponse returned by commands 19 and 27. */
export function decodeSecurityCandlestickResponse(data) {
  const response = { candlesticks: [] };
  decodeMessage(data, (reader, field, wireType) => {
    if (field === 1) {
      expectWireType(wireType, 2, field);
      response.symbol = reader.readString("candlestick response symbol");
    } else if (field === 2) {
      expectWireType(wireType, 2, field);
      response.candlesticks.push(decodeCandlestick(reader.readBytes("candlestick")));
    } else return false;
    return true;
  });
  return response;
}

/** Decodes quote.PushQuote delivered by push command 101. */
export function decodePushQuote(data) {
  const quote = {};
  decodeMessage(data, (reader, field, wireType) => {
    if (field === 1 || (field >= 3 && field <= 6) || field === 9 || field === 13) {
      expectWireType(wireType, 2, field);
      const names = {
        1: "symbol",
        3: "lastDone",
        4: "open",
        5: "high",
        6: "low",
        9: "turnover",
        13: "currentTurnover",
      };
      quote[names[field]] = reader.readString(`push quote ${names[field]}`);
    } else if (field === 2 || field === 7 || field === 8 || field === 12) {
      expectWireType(wireType, 0, field);
      const names = { 2: "sequence", 7: "timestamp", 8: "volume", 12: "currentVolume" };
      quote[names[field]] = signed64(reader.readVarint(`push quote ${names[field]}`));
    } else if (field === 10 || field === 11 || field === 14) {
      expectWireType(wireType, 0, field);
      const names = { 10: "tradeStatus", 11: "tradeSession", 14: "tag" };
      quote[names[field]] = unsigned32(
        reader.readVarint(`push quote ${names[field]}`),
        names[field],
      );
    } else return false;
    return true;
  });
  return quote;
}

/** Decodes control.AuthResponse returned by command 2. */
export function decodeAuthResponse(data) {
  const response = {};
  decodeMessage(data, (reader, field, wireType) => {
    if (field === 1) {
      expectWireType(wireType, 2, field);
      response.sessionId = reader.readString("session_id");
    } else if (field === 2) {
      expectWireType(wireType, 0, field);
      response.expires = signed64(reader.readVarint("expires"));
    } else if (field === 3 || field === 4) {
      expectWireType(wireType, 0, field);
      response[field === 3 ? "limit" : "online"] = unsigned32(
        reader.readVarint(field === 3 ? "limit" : "online"),
        field === 3 ? "limit" : "online",
      );
    } else return false;
    return true;
  });
  return response;
}

/** Decodes the protobuf error body used for non-zero response statuses. */
export function decodeErrorResponse(data) {
  const response = {};
  decodeMessage(data, (reader, field, wireType) => {
    if (field === 1) {
      expectWireType(wireType, 0, field);
      response.code = reader.readVarint("error code");
    } else if (field === 2) {
      expectWireType(wireType, 2, field);
      response.message = reader.readString("error message");
    } else return false;
    return true;
  });
  return response;
}
