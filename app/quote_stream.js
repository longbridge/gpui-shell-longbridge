// Quote-only Longbridge WebSocket session.  Transport and protobuf framing are
// intentionally separated: this module never exposes a trading command.
import { timer } from "gpui";
import { socketOtp } from "./http.js";

import {
  COMMAND,
  FRAME_TYPE,
  SUB_TYPE,
  decodeErrorResponse,
  decodeFrame,
  decodePushQuote,
  decodeSecurityQuoteResponse,
  encodeAuthRequest,
  encodeFrame,
  encodeHeartbeat,
  encodeRealtimeQuoteRequest,
  encodeSubscribeRequest,
} from "./protocol.js";

// Longbridge negotiates the binary protocol during the HTTP upgrade. These
// values match the official OpenAPI SDK: protocol v1, protobuf, OpenAPI client.
export const QUOTE_WS_URL = "wss://openapi-quote.longbridge.com/v2?version=1&codec=1&platform=9";

const DEFAULT_TIMEOUT_MILLIS = 5_000;
const DEFAULT_HEARTBEAT_MILLIS = 30_000;
const DEFAULT_RETRY_INITIAL_MILLIS = 1_000;
const DEFAULT_RETRY_MAX_MILLIS = 30_000;

function requireString(value, name) {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  return value;
}

function requireSymbols(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    throw new TypeError("symbols must be a non-empty array");
  }
  return symbols.map((symbol, index) => requireString(symbol, `symbols[${index}]`));
}

function requireCallback(value, name) {
  if (value !== undefined && typeof value !== "function")
    throw new TypeError(`${name} must be a function`);
  return value ?? (() => {});
}

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0)
    throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function defaultTimers() {
  return {
    after: (delay, callback) => timer.after(delay, callback),
    every: (delay, callback) => timer.every(delay, callback),
  };
}

function cancel(handle) {
  if (handle && typeof handle.cancel === "function") handle.cancel();
}

function responseError(packet) {
  let detail = "";
  try {
    const error = decodeErrorResponse(packet.body);
    if (error.code !== undefined || error.message !== undefined) {
      detail = ` (${error.code ?? "unknown"}: ${error.message ?? ""})`;
    }
  } catch {
    // A non-protobuf error body still carries a meaningful response status.
  }
  return new Error(
    `Longbridge command ${packet.command} failed with status ${packet.status}${detail}`,
  );
}

/**
 * Opens a read-only Longbridge quote stream.
 *
 * `WebSocket` and `timers` are optional test seams; ordinary callers only need
 * accessToken, symbols, onQuote, and onStatus.
 */
export function createQuoteStream(options) {
  if (!options || typeof options !== "object") throw new TypeError("options must be an object");
  const accessToken = requireString(options.accessToken, "accessToken");
  const getOtp = options.getOtp ?? socketOtp;
  if (typeof getOtp !== "function") throw new TypeError("getOtp must be a function");
  const handshakeHeaders = {
    "accept-language": "en-US",
    "x-dc-region": accessToken.startsWith("us_") ? "us" : "ap",
  };
  const symbols = requireSymbols(options.symbols);
  const onQuote = requireCallback(options.onQuote, "onQuote");
  const onStatus = requireCallback(options.onStatus, "onStatus");
  const transport = options.WebSocket ?? WebSocket;
  if (!transport || typeof transport.connect !== "function")
    throw new TypeError("WebSocket.connect must be available");
  const timers = options.timers ?? defaultTimers();
  if (typeof timers.after !== "function" || typeof timers.every !== "function") {
    throw new TypeError("timers must provide after(delay, callback) and every(delay, callback)");
  }
  const url = options.url ?? QUOTE_WS_URL;
  const timeoutMillis = requirePositiveInteger(
    options.timeoutMillis ?? DEFAULT_TIMEOUT_MILLIS,
    "timeoutMillis",
  );
  const heartbeatMillis = requirePositiveInteger(
    options.heartbeatMillis ?? DEFAULT_HEARTBEAT_MILLIS,
    "heartbeatMillis",
  );
  const retryInitialMillis = requirePositiveInteger(
    options.retryInitialMs ?? DEFAULT_RETRY_INITIAL_MILLIS,
    "retryInitialMs",
  );
  const retryMaxMillis = requirePositiveInteger(
    options.retryMaxMs ?? DEFAULT_RETRY_MAX_MILLIS,
    "retryMaxMs",
  );

  let stopped = true;
  let current = null;
  let retryHandle = null;
  let heartbeatHandle = null;
  let reconnectAttempt = 0;
  let startPromise = null;

  const emitStatus = (state, extra = {}) => onStatus({ state, ...extra });
  const active = (session) => !stopped && current === session;

  function clearHeartbeat() {
    cancel(heartbeatHandle);
    heartbeatHandle = null;
  }

  function rejectPending(session, error) {
    for (const pending of session.pending.values()) {
      cancel(pending.timeout);
      pending.reject(error);
    }
    session.pending.clear();
  }

  function closeSocket(socket) {
    try {
      const closing = socket.close();
      if (closing && typeof closing.catch === "function") closing.catch(() => {});
    } catch {
      // A dead socket has already reached the same terminal state.
    }
  }

  function scheduleReconnect(error) {
    if (stopped || retryHandle) return;
    const delay = Math.min(retryInitialMillis * 2 ** reconnectAttempt, retryMaxMillis);
    reconnectAttempt += 1;
    emitStatus("reconnecting", {
      delay,
      attempt: reconnectAttempt,
      error: String(error?.message ?? error),
    });
    retryHandle = timers.after(delay, () => {
      retryHandle = null;
      if (!stopped) connectAndSubscribe().catch(() => {});
    });
  }

  function lost(session, error) {
    if (!active(session)) return;
    current = null;
    clearHeartbeat();
    rejectPending(session, error);
    closeSocket(session.socket);
    scheduleReconnect(error);
  }

  function nextRequestId(session) {
    session.requestId = (session.requestId + 1) >>> 0;
    if (session.requestId === 0) session.requestId = 1;
    return session.requestId;
  }

  function request(session, command, body) {
    if (!active(session)) return Promise.reject(new Error("quote stream is not connected"));
    const requestId = nextRequestId(session);
    const frame = encodeFrame({
      type: FRAME_TYPE.REQUEST,
      command,
      requestId,
      timeoutMillis,
      body,
    });
    return new Promise((resolve, reject) => {
      const timeout = timers.after(timeoutMillis, () => {
        if (!session.pending.delete(requestId)) return;
        const error = new Error(`Longbridge command ${command} timed out after ${timeoutMillis}ms`);
        reject(error);
        lost(session, error);
      });
      session.pending.set(requestId, { command, resolve, reject, timeout });
      try {
        const writing = session.socket.write(frame);
        Promise.resolve(writing).catch((error) => {
          if (session.pending.delete(requestId)) {
            cancel(timeout);
            reject(error);
          }
          lost(session, error);
        });
      } catch (error) {
        session.pending.delete(requestId);
        cancel(timeout);
        reject(error);
        lost(session, error);
      }
    });
  }

  function receiveResponse(session, packet) {
    const pending = session.pending.get(packet.requestId);
    if (!pending) throw new Error(`unexpected Longbridge response id ${packet.requestId}`);
    if (pending.command !== packet.command) {
      session.pending.delete(packet.requestId);
      cancel(pending.timeout);
      pending.reject(
        new Error(
          `response command ${packet.command} did not match request command ${pending.command}`,
        ),
      );
      throw new Error("Longbridge response command mismatch");
    }
    session.pending.delete(packet.requestId);
    cancel(pending.timeout);
    if (packet.status === 0) pending.resolve(packet.body);
    else pending.reject(responseError(packet));
  }

  function receivePush(packet) {
    if (packet.command !== COMMAND.PUSH_QUOTE) return;
    const quote = decodePushQuote(packet.body);
    try {
      onQuote(quote);
    } catch (error) {
      emitStatus("callback_error", { error: String(error?.message ?? error) });
    }
  }

  async function readLoop(session) {
    try {
      while (active(session)) {
        const message = await session.socket.read();
        if (!active(session)) return;
        if (!(message instanceof Uint8Array))
          throw new Error("Longbridge quote stream received a non-binary message");
        const packet = decodeFrame(message);
        if (packet.type === FRAME_TYPE.RESPONSE) receiveResponse(session, packet);
        else if (packet.type === FRAME_TYPE.PUSH) receivePush(packet);
        else throw new Error(`unexpected Longbridge frame type ${packet.type}`);
      }
    } catch (error) {
      lost(session, error);
    }
  }

  function startHeartbeat(session) {
    clearHeartbeat();
    heartbeatHandle = timers.every(heartbeatMillis, () => {
      if (!active(session)) return;
      request(session, COMMAND.HEARTBEAT, encodeHeartbeat({ timestamp: BigInt(Date.now()) })).catch(
        (error) => lost(session, error),
      );
    });
  }

  async function connectAndSubscribe() {
    let session = null;
    try {
      emitStatus("connecting");
      const socket = await transport.connect(url, { headers: handshakeHeaders });
      if (stopped) {
        closeSocket(socket);
        return;
      }
      session = { socket, requestId: 0, pending: new Map() };
      current = session;
      readLoop(session);

      emitStatus("authenticating");
      const otp = requireString(await getOtp(accessToken), "OTP");
      await request(session, COMMAND.AUTH, encodeAuthRequest({ token: otp }));
      if (!active(session)) throw new Error("quote stream disconnected during authentication");

      emitStatus("subscribing");
      await request(
        session,
        COMMAND.SUBSCRIBE,
        encodeSubscribeRequest({
          symbols,
          subTypes: [SUB_TYPE.QUOTE],
          isFirstPush: true,
        }),
      );
      if (!active(session)) throw new Error("quote stream disconnected during subscription");

      emitStatus("snapshotting");
      const snapshot = await request(
        session,
        COMMAND.REALTIME_QUOTE,
        encodeRealtimeQuoteRequest(symbols),
      );
      for (const quote of decodeSecurityQuoteResponse(snapshot)) {
        try {
          onQuote(quote);
        } catch (error) {
          emitStatus("callback_error", { error: String(error?.message ?? error) });
        }
      }
      if (!active(session)) throw new Error("quote stream disconnected during initial snapshot");

      reconnectAttempt = 0;
      startHeartbeat(session);
      emitStatus("connected");
    } catch (error) {
      if (session && active(session)) lost(session, error);
      else if (!stopped && !retryHandle) scheduleReconnect(error);
      throw error;
    }
  }

  return {
    start() {
      if (!stopped && current) return startPromise ?? Promise.resolve();
      if (startPromise) return startPromise;
      stopped = false;
      startPromise = connectAndSubscribe().finally(() => {
        startPromise = null;
      });
      return startPromise;
    },

    async stop() {
      if (stopped) return;
      stopped = true;
      cancel(retryHandle);
      retryHandle = null;
      clearHeartbeat();
      const session = current;
      current = null;
      if (session) {
        rejectPending(session, new Error("quote stream stopped"));
        try {
          await session.socket.close();
        } catch {
          // Closing is best-effort after locally preventing reconnects.
        }
      }
      emitStatus("stopped");
    },
  };
}
