// The trade gateway's push channel: this account's own orders, as they change.
//
// A second socket, to a second host. It shares the frame, the authentication
// and the heartbeat with the quote stream and nothing else -- the two gateways
// number their commands independently, so 18 is an intraday request over there
// and a push notification here.
//
// What it replaces is polling. An order was placed, the list was read back,
// and the list did not have it yet -- because Longbridge accepts an order
// before its list reports one. Waiting for the order to arrive is what this is
// for: the gateway says when it changed, rather than being asked.
//
// It is deliberately much smaller than `quote_stream.js`. There is one
// subscription, made once, and it never changes; there are no per-symbol
// requests, no snapshots and no selection to keep in step.

import { WebSocket } from "websocket";
import {
  FRAME_TYPE,
  TRADE_COMMAND,
  TRADE_CONTENT_JSON,
  TRADE_TOPIC_PRIVATE,
  decodeFrame,
  decodeTradeNotification,
  decodeUtf8,
  encodeAuthRequest,
  encodeFrame,
  encodeHeartbeat,
  encodeTradeSubscribeRequest,
} from "./protocol.js";
import { context } from "./context.js";
import { API_LANGUAGE, socketOtp } from "./http.js";

export const TRADE_WS_URL = "wss://openapi-trade.longbridge.com/v2?version=1&codec=1&platform=9";

const DEFAULT_TIMEOUT_MILLIS = 10_000;
const DEFAULT_HEARTBEAT_MILLIS = 30_000;
const DEFAULT_RETRY_INITIAL_MILLIS = 1_000;
const DEFAULT_RETRY_MAX_MILLIS = 30_000;

/** @param {unknown} value @param {string} name */
function requireCallback(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
  return value;
}

/** The private topic's event name for a change to one of this account's orders. */
export const ORDER_CHANGED_EVENT = "order_changed_lb";

/**
 * The order inside a push notification, still in the gateway's own field names.
 *
 * The private topic carries more than orders -- asset changes, and grid master
 * orders, which have an `order_id` of their own and are not orders this
 * application shows -- so the event name is what selects, not the shape. A
 * notification that is not an order change is not an error: it is somebody
 * else's message on a shared topic.
 *
 * The mapping into a row belongs to `orders.js`, because the push spells three
 * fields differently from the endpoints that return the same order.
 *
 * @param {{ topic: string, contentType: number, data: Uint8Array }} notification
 */
export function orderFromNotification(notification) {
  if (notification.topic !== TRADE_TOPIC_PRIVATE) return null;
  if (notification.contentType !== TRADE_CONTENT_JSON) return null;
  let payload;
  try {
    payload = JSON.parse(decodeUtf8(notification.data, "notification data"));
  } catch (_) {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  if (payload.event !== ORDER_CHANGED_EVENT) return null;
  const order = payload.data;
  if (!order || typeof order !== "object") return null;
  return typeof order.order_id === "string" && order.order_id !== "" ? order : null;
}

/**
 * The `event` a notification names, for saying what was ignored and why.
 *
 * Best effort: a body that will not parse has no event, and that is itself
 * the answer.
 *
 * @param {{ contentType: number, data: Uint8Array }} notification
 */
function eventName(notification) {
  if (notification.contentType !== TRADE_CONTENT_JSON) return "";
  try {
    const payload = JSON.parse(decodeUtf8(notification.data, "notification data"));
    return typeof payload?.event === "string" ? payload.event : "";
  } catch (_) {
    return "";
  }
}

/**
 * Opens the trade gateway and reports every order change on this account.
 *
 * @param {{
 *   accessToken: string,
 *   getOtp: (token: string) => Promise<string>,
 *   onOrder: (order: Record<string, unknown>) => void,
 *   onStatus?: (status: string, detail?: Record<string, unknown>) => void,
 *   url?: string,
 *   WebSocket?: unknown,
 *   timers?: { after: Function, every: Function, cancel?: Function },
 *   timeoutMillis?: number,
 *   heartbeatMillis?: number,
 * }} options
 */
export function createTradeStream(options) {
  const accessToken = options.accessToken;
  if (typeof accessToken !== "string" || accessToken === "") {
    throw new TypeError("accessToken must be a non-empty string");
  }
  const getOtp = requireCallback(options.getOtp ?? socketOtp, "getOtp");
  const onOrder = requireCallback(options.onOrder, "onOrder");
  const onStatus = typeof options.onStatus === "function" ? options.onStatus : () => {};
  const transport = options.WebSocket ?? WebSocket;
  if (!transport || typeof transport.connect !== "function") {
    throw new TypeError("WebSocket.connect must be available");
  }
  // The shell's own timers. There is no `setTimeout` here, and a default that
  // reaches for one turns every reconnect into a reconnect that also fails.
  const timers = options.timers ?? {
    after: (delay, callback) => context().timer.after(delay, callback),
    every: (delay, callback) => context().timer.every(delay, callback),
  };
  const cancel = (handle) => {
    if (handle === null || handle === undefined) return;
    if (typeof timers.cancel === "function") timers.cancel(handle);
    else if (typeof handle.cancel === "function") handle.cancel();
  };
  const url = options.url ?? TRADE_WS_URL;
  const timeoutMillis = options.timeoutMillis ?? DEFAULT_TIMEOUT_MILLIS;
  const heartbeatMillis = options.heartbeatMillis ?? DEFAULT_HEARTBEAT_MILLIS;
  const handshakeHeaders = {
    "accept-language": API_LANGUAGE,
    "x-dc-region": accessToken.startsWith("us_") ? "us" : "ap",
  };

  let current = null;
  let stopped = false;
  let heartbeatHandle = null;
  let retryHandle = null;
  let retryMillis = DEFAULT_RETRY_INITIAL_MILLIS;

  const active = (session) => !stopped && session !== null && current === session;

  function clearHeartbeat() {
    cancel(heartbeatHandle);
    heartbeatHandle = null;
  }

  function closeSocket(socket) {
    try {
      socket?.close();
    } catch (_) {
      // A socket that is already gone needs no closing.
    }
  }

  /** Fails every request still waiting on a session that has ended. */
  function rejectPending(session, error) {
    for (const [, pending] of session.pending) {
      cancel(pending.timeout);
      pending.reject(error);
    }
    session.pending.clear();
  }

  function lost(session, error) {
    if (!active(session)) return;
    current = null;
    clearHeartbeat();
    rejectPending(session, error instanceof Error ? error : new Error(String(error)));
    closeSocket(session.socket);
    scheduleReconnect(error);
  }

  function scheduleReconnect(error) {
    if (stopped) return;
    onStatus("reconnecting", { delay: retryMillis, error: String(error?.message ?? error) });
    cancel(retryHandle);
    retryHandle = timers.after(retryMillis, () => {
      retryMillis = Math.min(retryMillis * 2, DEFAULT_RETRY_MAX_MILLIS);
      connect().catch((failure) => scheduleReconnect(failure));
    });
  }

  function request(session, command, body) {
    if (!active(session)) return Promise.reject(new Error("trade stream is not connected"));
    session.requestId = (session.requestId + 1) >>> 0 || 1;
    const requestId = session.requestId;
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
        const error = new Error(`Longbridge trade command ${command} timed out`);
        reject(error);
        lost(session, error);
      });
      session.pending.set(requestId, { command, resolve, reject, timeout });
      try {
        Promise.resolve(session.socket.write(frame)).catch((error) => {
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
    if (!pending) return;
    session.pending.delete(packet.requestId);
    cancel(pending.timeout);
    if (packet.status && packet.status !== 0) {
      pending.reject(
        new Error(`Longbridge trade command ${packet.command} failed (${packet.status})`),
      );
      return;
    }
    pending.resolve(packet.body);
  }

  function receivePush(packet) {
    if (packet.command !== TRADE_COMMAND.PUSH_NOTIFICATION) return;
    const notification = decodeTradeNotification(packet.body);
    const order = orderFromNotification(notification);
    // An asset change arrives on the same topic and is not one of these. The
    // channel reports what it understands and lets the rest past -- but it
    // says what it let past. Which notifications carry an order is a fact
    // about the gateway, taken from an SDK rather than from a field table, and
    // a wrong reading of it looks exactly like no orders being sent at all.
    if (!order) {
      onStatus("ignored", {
        topic: notification.topic,
        contentType: notification.contentType,
        event: eventName(notification),
      });
      return;
    }
    try {
      onOrder(order);
    } catch (error) {
      // A callback that throws is the application's problem, not the socket's.
      // Letting it out of here would unwind the read loop and drop the
      // connection over a rendering fault.
      onStatus("callback_error", { error: String(error?.message ?? error) });
    }
  }

  async function readLoop(session) {
    try {
      while (active(session)) {
        const message = await session.socket.read();
        if (!active(session)) return;
        if (!(message instanceof Uint8Array)) {
          throw new Error("Longbridge trade stream received a non-binary message");
        }
        const packet = decodeFrame(message);
        if (packet.type === FRAME_TYPE.RESPONSE) receiveResponse(session, packet);
        else if (packet.type === FRAME_TYPE.PUSH) receivePush(packet);
      }
    } catch (error) {
      lost(session, error);
    }
  }

  function startHeartbeat(session) {
    clearHeartbeat();
    heartbeatHandle = timers.every(heartbeatMillis, () => {
      if (!active(session)) return;
      request(
        session,
        TRADE_COMMAND.HEARTBEAT,
        encodeHeartbeat({ timestamp: BigInt(Date.now()) }),
      ).catch((error) => lost(session, error));
    });
  }

  async function connect() {
    let session = null;
    try {
      onStatus("connecting");
      const socket = await transport.connect(url, { headers: handshakeHeaders });
      if (stopped) {
        closeSocket(socket);
        return;
      }
      session = { socket, requestId: 0, pending: new Map() };
      current = session;
      readLoop(session);

      onStatus("authenticating");
      const otp = await getOtp(accessToken);
      await request(
        session,
        TRADE_COMMAND.AUTH,
        encodeAuthRequest({ token: otp, metadata: { "accept-language": API_LANGUAGE } }),
      );
      if (!active(session)) throw new Error("trade stream disconnected during authentication");

      onStatus("subscribing");
      await request(
        session,
        TRADE_COMMAND.SUBSCRIBE,
        encodeTradeSubscribeRequest([TRADE_TOPIC_PRIVATE]),
      );
      if (!active(session)) throw new Error("trade stream disconnected during subscription");

      // One subscription, made once. Reaching this point is the whole of the
      // connection, so the backoff resets here rather than on the socket
      // opening -- a socket that opens and then fails to authenticate has not
      // succeeded at anything worth resetting for.
      retryMillis = DEFAULT_RETRY_INITIAL_MILLIS;
      startHeartbeat(session);
      onStatus("connected");
    } catch (error) {
      if (session) lost(session, error);
      else scheduleReconnect(error);
    }
  }

  return {
    start() {
      if (stopped || current) return;
      connect().catch((error) => scheduleReconnect(error));
    },
    stop() {
      stopped = true;
      clearHeartbeat();
      cancel(retryHandle);
      retryHandle = null;
      const session = current;
      current = null;
      if (session) {
        rejectPending(session, new Error("trade stream stopped"));
        closeSocket(session.socket);
      }
    },
    isConnected() {
      return current !== null;
    },
  };
}
