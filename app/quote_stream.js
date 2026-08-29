// Quote-only Longbridge WebSocket session.  Transport and protobuf framing are
// intentionally separated: this module never exposes a trading command.

import { WebSocket } from "websocket";
import { context } from "./context.js";
import { API_LANGUAGE, socketOtp } from "./http.js";

import {
  COMMAND,
  FRAME_TYPE,
  SUB_TYPE,
  TRADE_SESSION,
  decodeErrorResponse,
  decodeFrame,
  decodePushDepth,
  decodePushQuote,
  decodePushTrade,
  decodeSecurityCandlestickResponse,
  decodeSecurityDepthResponse,
  decodeSecurityIntradayResponse,
  decodeSecurityQuoteResponse,
  decodeSecurityStaticInfoResponse,
  decodeSecurityTradeResponse,
  encodeAuthRequest,
  encodeFrame,
  encodeHeartbeat,
  encodeHistoryCandlestickDateRequest,
  encodeIntradayRequest,
  encodeRealtimeQuoteRequest,
  encodeSecurityRequest,
  encodeSecurityCandlestickRequest,
  encodeSecurityTradeRequest,
  encodeSubscribeRequest,
  encodeUnsubscribeRequest,
} from "./protocol.js";

// Longbridge negotiates the binary protocol during the HTTP upgrade. These
// values match the official OpenAPI SDK: protocol v1, protobuf, OpenAPI client.
export const QUOTE_WS_URL = "wss://openapi-quote.longbridge.com/v2?version=1&codec=1&platform=9";

const DEFAULT_TIMEOUT_MILLIS = 5_000;
const DEFAULT_HEARTBEAT_MILLIS = 30_000;
// Generous next to the per-request timeout: a handshake is an OTP fetch plus
// three round trips plus the snapshot it hands to onQuote.
const DEFAULT_HANDSHAKE_MILLIS = 20_000;
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
    after: (delay, callback) => context().timer.after(delay, callback),
    every: (delay, callback) => context().timer.every(delay, callback),
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

const INTRADAY_SESSIONS = Object.freeze([
  TRADE_SESSION.NORMAL,
  TRADE_SESSION.PRE,
  TRADE_SESSION.POST,
  TRADE_SESSION.OVERNIGHT,
]);
const DETAIL_SUB_TYPES = Object.freeze([SUB_TYPE.DEPTH, SUB_TYPE.TRADE]);

function mergeIntradayResponses(symbol, responses) {
  const indexedLines = [];
  for (const { lines, tradeSession } of responses) {
    for (const line of lines) {
      indexedLines.push({ ...line, tradeSession, index: indexedLines.length });
    }
  }
  indexedLines.sort((left, right) => {
    if (typeof left.timestamp === "bigint" && typeof right.timestamp === "bigint") {
      if (left.timestamp < right.timestamp) return -1;
      if (left.timestamp > right.timestamp) return 1;
    }
    if (left.tradeSession !== right.tradeSession) return left.tradeSession - right.tradeSession;
    return left.index - right.index;
  });
  return {
    symbol: responses.find((response) => response.symbol)?.symbol ?? symbol,
    lines: indexedLines.map(({ index, ...line }) => line),
  };
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
    "accept-language": API_LANGUAGE,
    "x-dc-region": accessToken.startsWith("us_") ? "us" : "ap",
  };
  // Mutable, because the watchlist is: what is subscribed now and what a
  // reconnect resubscribes have to be the same list, and that list grows and
  // shrinks while the session is up.
  let symbols = requireSymbols(options.symbols);
  const onQuote = requireCallback(options.onQuote, "onQuote");
  const onDepth = requireCallback(options.onDepth, "onDepth");
  const onTrades = requireCallback(options.onTrades, "onTrades");
  const onDetailError = requireCallback(options.onDetailError, "onDetailError");
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
  const handshakeMillis = requirePositiveInteger(
    options.handshakeMillis ?? DEFAULT_HANDSHAKE_MILLIS,
    "handshakeMillis",
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
  let handshakeHandle = null;
  let reconnectAttempt = 0;
  let startPromise = null;
  let selectedDetailSymbol = null;
  let selectedDetailGeneration = null;
  // PushDepth/PushTrade carry a symbol and sequence, not a subscription
  // generation. On this ordered socket, unsubscribe/subscribe responses plus
  // the selected snapshot responses are the only provenance barrier: pushes
  // stay disabled until that barrier completes. Afterwards an A push is
  // protocol-wise the final-A stream; the wire offers no basis to call it old.
  let activeDetailGeneration = null;
  let detailEpoch = 0;
  let detailTransition = Promise.resolve();

  const emitStatus = (state, extra = {}) => onStatus({ state, ...extra });
  const active = (session) => !stopped && current === session;
  const selectedDetailIs = (symbol, generation) =>
    selectedDetailSymbol === symbol && selectedDetailGeneration === generation;

  function emitDetailError(symbol, generation, error) {
    if (!selectedDetailIs(symbol, generation)) return;
    try {
      onDetailError({
        symbol,
        generation,
        error: error instanceof Error ? error.message : String(error),
      });
    } catch (callbackError) {
      emitStatus("callback_error", { error: String(callbackError?.message ?? callbackError) });
    }
  }

  function clearHeartbeat() {
    cancel(heartbeatHandle);
    heartbeatHandle = null;
  }

  function clearHandshake() {
    cancel(handshakeHandle);
    handshakeHandle = null;
  }

  /**
   * Bounds how long a session may stay mid-handshake.
   *
   * `connectAndSubscribe` cannot rely on its own catch to clean up after
   * itself. The sandbox interrupts a script that overruns its execution
   * budget, and that interrupt is not catchable, so it unwinds past every
   * `catch` on the way out -- including the one that calls `lost`. A session
   * cut down that way still looks active: the socket is open, the
   * subscription is live, pushes keep arriving. Nothing else in this module
   * can tell that it never reached `connected`, so nothing else will ever
   * restart it. This deadline is the only thing that will.
   *
   * `getSession` is read on expiry rather than captured, because the
   * handshake is armed before there is a session to hand over.
   */
  function armHandshake(getSession) {
    clearHandshake();
    handshakeHandle = timers.after(handshakeMillis, () => {
      handshakeHandle = null;
      const session = getSession();
      const error = new Error(`quote stream handshake did not finish in ${handshakeMillis}ms`);
      if (session && active(session)) lost(session, error);
      else if (!stopped && !retryHandle) scheduleReconnect(error);
    });
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
    clearHandshake();
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
    let callback;
    let payload;
    if (packet.command === COMMAND.PUSH_QUOTE) {
      callback = onQuote;
      payload = decodePushQuote(packet.body);
    } else if (packet.command === COMMAND.PUSH_DEPTH) {
      callback = onDepth;
      payload = decodePushDepth(packet.body);
    } else if (packet.command === COMMAND.PUSH_TRADE) {
      callback = onTrades;
      payload = decodePushTrade(packet.body);
    } else {
      return;
    }
    if (
      (packet.command === COMMAND.PUSH_DEPTH || packet.command === COMMAND.PUSH_TRADE) &&
      (payload.symbol !== selectedDetailSymbol ||
        activeDetailGeneration !== selectedDetailGeneration)
    ) {
      return;
    }
    try {
      callback(payload, activeDetailGeneration);
    } catch (error) {
      emitStatus("callback_error", { error: String(error?.message ?? error) });
    }
  }

  async function requestDetailSnapshots(session, symbol, generation) {
    const [depthBody, tradesBody] = await Promise.all([
      request(session, COMMAND.DEPTH, encodeSecurityRequest(symbol)),
      request(session, COMMAND.TRADES, encodeSecurityTradeRequest({ symbol, count: 20 })),
    ]);
    if (!active(session) || !selectedDetailIs(symbol, generation)) return;
    try {
      const depth = decodeSecurityDepthResponse(depthBody);
      const trades = decodeSecurityTradeResponse(tradesBody);
      if (
        !active(session) ||
        !selectedDetailIs(symbol, generation) ||
        depth.symbol !== symbol ||
        trades.symbol !== symbol
      ) {
        return;
      }
      activeDetailGeneration = generation;
      onDepth(depth, generation);
      onTrades(trades, generation);
    } catch (error) {
      emitDetailError(symbol, generation, error);
    }
  }

  async function subscribeDetail(session, symbol, generation) {
    await request(
      session,
      COMMAND.SUBSCRIBE,
      encodeSubscribeRequest({ symbols: [symbol], subTypes: DETAIL_SUB_TYPES, isFirstPush: true }),
    );
    if (!active(session) || !selectedDetailIs(symbol, generation)) return;
    await requestDetailSnapshots(session, symbol, generation);
  }

  async function synchronizeDetailSelection(previous, symbol, generation) {
    const session = current;
    if (!session || !active(session)) return;
    try {
      if (previous) {
        await request(
          session,
          COMMAND.UNSUBSCRIBE,
          encodeUnsubscribeRequest({ symbols: [previous], subTypes: DETAIL_SUB_TYPES }),
        );
      }
      if (symbol) await subscribeDetail(session, symbol, generation);
    } catch (error) {
      // Depth/Trades permissions are an optional selected-detail capability.
      // They must not make a healthy Quote handshake disconnect or retry.
      emitDetailError(symbol, generation, error);
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
    activeDetailGeneration = null;
    armHandshake(() => session);
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
      await request(
        session,
        COMMAND.AUTH,
        encodeAuthRequest({ token: otp, metadata: { "accept-language": API_LANGUAGE } }),
      );
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
          // SecurityQuote has no trade_session. Preserve that distinction so
          // market hours can be inferred until PushQuote supplies the session.
          onQuote(quote);
        } catch (error) {
          emitStatus("callback_error", { error: String(error?.message ?? error) });
        }
      }
      if (!active(session)) throw new Error("quote stream disconnected during initial snapshot");

      if (selectedDetailSymbol) {
        await synchronizeDetailSelection(null, selectedDetailSymbol, selectedDetailGeneration);
      }
      if (!active(session)) throw new Error("quote stream disconnected during detail snapshot");

      reconnectAttempt = 0;
      startHeartbeat(session);
      emitStatus("connected");
      // Disarmed last, so an interrupt anywhere above still expires into a
      // reconnect rather than leaving the session stranded.
      clearHandshake();
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
      clearHandshake();
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

    async queryIntraday({ symbol, tradeSession }) {
      const session = current;
      if (!session || !active(session)) throw new Error("quote stream is not connected");
      const requestedSessions =
        tradeSession === TRADE_SESSION.ALL
          ? INTRADAY_SESSIONS
          : [tradeSession ?? TRADE_SESSION.NORMAL];
      const responses = [];
      for (const requestedSession of requestedSessions) {
        const body = await request(
          session,
          COMMAND.INTRADAY,
          encodeIntradayRequest({ symbol, tradeSession: requestedSession }),
        );
        const decoded = decodeSecurityIntradayResponse(body);
        responses.push({ ...decoded, tradeSession: requestedSession });
      }
      return mergeIntradayResponses(symbol, responses);
    },

    async queryCandlesticks({ symbol, period, startDate, endDate, tradeSession, count }) {
      const session = current;
      if (!session || !active(session)) throw new Error("quote stream is not connected");
      const useHistory = startDate !== undefined || endDate !== undefined;
      if (useHistory && (startDate === undefined || endDate === undefined)) {
        throw new TypeError("startDate and endDate must be provided together");
      }
      const body = await request(
        session,
        useHistory ? COMMAND.HISTORY_CANDLESTICKS : COMMAND.CANDLESTICKS,
        useHistory
          ? encodeHistoryCandlestickDateRequest({
              symbol,
              startDate,
              endDate,
              period,
              tradeSession,
            })
          : encodeSecurityCandlestickRequest({ symbol, period, count, tradeSession }),
      );
      return decodeSecurityCandlestickResponse(body);
    },

    async queryDepth(symbol) {
      const session = current;
      if (!session || !active(session)) throw new Error("quote stream is not connected");
      return decodeSecurityDepthResponse(
        await request(
          session,
          COMMAND.DEPTH,
          encodeSecurityRequest(requireString(symbol, "symbol")),
        ),
      );
    },

    async queryTrades(symbol, count = 20) {
      const session = current;
      if (!session || !active(session)) throw new Error("quote stream is not connected");
      return decodeSecurityTradeResponse(
        await request(
          session,
          COMMAND.TRADES,
          encodeSecurityTradeRequest({
            symbol: requireString(symbol, "symbol"),
            count: requirePositiveInteger(count, "count"),
          }),
        ),
      );
    },

    /**
     * What a security is, before it is anything to this account: its name, the
     * exchange it trades on and the currency it trades in.
     *
     * This is what the add-a-security surface previews. It asks the same
     * socket the prices come over, because the quote API has no HTTP door --
     * `openapi-quote` speaks WebSocket and nothing else.
     *
     * @param {string[]} wanted
     */
    async queryStaticInfo(wanted) {
      const session = current;
      if (!session || !active(session)) throw new Error("quote stream is not connected");
      return decodeSecurityStaticInfoResponse(
        await request(
          session,
          COMMAND.STATIC_INFO,
          encodeRealtimeQuoteRequest(requireSymbols(wanted)),
        ),
      );
    },

    /** The current quote for symbols this stream may not be subscribed to. */
    async queryQuotes(wanted) {
      const session = current;
      if (!session || !active(session)) throw new Error("quote stream is not connected");
      return decodeSecurityQuoteResponse(
        await request(
          session,
          COMMAND.REALTIME_QUOTE,
          encodeRealtimeQuoteRequest(requireSymbols(wanted)),
        ),
      );
    },

    /**
     * Adds symbols to the quote subscription, and to what a reconnect will ask
     * for again.
     *
     * The snapshot is requested for the new symbols alone: a row added to a
     * watchlist has no price until the market sends one, and waiting for the
     * next push would leave it blank for as long as the instrument is quiet.
     *
     * @param {string[]} added
     */
    async watchSymbols(added) {
      const fresh = requireSymbols(added).filter((symbol) => !symbols.includes(symbol));
      if (fresh.length === 0) return;
      symbols = [...symbols, ...fresh];
      const session = current;
      // Not connected: the list is what matters, and the next handshake
      // subscribes to all of it.
      if (!session || !active(session)) return;
      await request(
        session,
        COMMAND.SUBSCRIBE,
        encodeSubscribeRequest({ symbols: fresh, subTypes: [SUB_TYPE.QUOTE], isFirstPush: true }),
      );
      if (!active(session)) return;
      const snapshot = await request(
        session,
        COMMAND.REALTIME_QUOTE,
        encodeRealtimeQuoteRequest(fresh),
      );
      for (const quote of decodeSecurityQuoteResponse(snapshot)) {
        try {
          onQuote(quote);
        } catch (error) {
          emitStatus("callback_error", { error: String(error?.message ?? error) });
        }
      }
    },

    /**
     * Drops symbols from the quote subscription and from the reconnect list.
     *
     * The selected instrument's depth and tape are a separate subscription
     * under their own sub-types, so this cannot take them away from an
     * instrument that is still being read.
     *
     * @param {string[]} dropped
     */
    async unwatchSymbols(dropped) {
      const stale = requireSymbols(dropped).filter((symbol) => symbols.includes(symbol));
      if (stale.length === 0) return;
      symbols = symbols.filter((symbol) => !stale.includes(symbol));
      const session = current;
      if (!session || !active(session)) return;
      await request(
        session,
        COMMAND.UNSUBSCRIBE,
        encodeUnsubscribeRequest({ symbols: stale, subTypes: [SUB_TYPE.QUOTE] }),
      );
    },

    selectDetailSymbol(symbol, generation) {
      if (symbol !== null) requireString(symbol, "symbol");
      const detailGeneration = generation ?? ++detailEpoch;
      if (symbol === selectedDetailSymbol && detailGeneration === selectedDetailGeneration)
        return detailTransition;
      const previous = selectedDetailSymbol;
      selectedDetailSymbol = symbol;
      selectedDetailGeneration = detailGeneration;
      activeDetailGeneration = null;
      const transition = detailTransition.then(() =>
        synchronizeDetailSelection(previous, symbol, detailGeneration),
      );
      detailTransition = transition.catch(() => {});
      return transition;
    },
  };
}
