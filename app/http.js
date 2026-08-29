// The Longbridge REST boundary. OAuth owns the two necessary form POSTs in
// auth.js; everything else goes through one of two doors here.
//
// `get` reads, and refuses any path not on its list. `put` writes, and its
// list is one path long: the watchlist's own groups, which is what adding and
// taking away a security is. No order-writing method is available from this
// module -- the two trade paths read an account's own order history, and
// nothing here can submit, change or withdraw one.

import { context } from "./context.js";
import { OPENAPI_BASE_URL, accessToken, refreshAccessToken } from "./auth.js";

const REQUEST_TIMEOUT_MS = 15_000;

// Longbridge localizes security names, statuses and error messages from
// Accept-Language. Only "zh-CN", "zh-HK" and "en" are recognized: a
// region-tagged variant such as "en-US" falls back to the account default,
// which is usually Chinese.
export const API_LANGUAGE = "en";

const READ_ONLY_PREFIXES = ["/v1/quote/"];
const READ_ONLY_PATHS = new Set([
  "/v1/asset/account",
  "/v1/asset/exchange_rates",
  "/v1/asset/stock",
  "/v1/socket/token",
  "/v1/trade/order/history",
  "/v1/trade/order/today",
  "/v1/watchlist/groups",
]);

// The watchlist is a list of what to watch, and this is the one thing the
// application changes. Everything else it touches, it reads.
const EDITABLE_PATHS = new Set(["/v1/watchlist/groups"]);

/** @param {string} path */
function assertEditablePath(path) {
  if (typeof path !== "string" || !EDITABLE_PATHS.has(path)) {
    throw new Error(`Longbridge HTTP refuses to write to ${String(path)}`);
  }
}

/** @param {string} path */
function assertReadOnlyPath(path) {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    (!READ_ONLY_PATHS.has(path) && !READ_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix)))
  ) {
    throw new Error(`Longbridge read-only HTTP refuses ${String(path)}`);
  }
}

/** @param {Record<string, string | number | boolean | undefined>} query */
function queryString(query) {
  const pairs = Object.entries(query)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return pairs.length === 0 ? "" : `?${pairs.join("&")}`;
}

/** @param {string} path @param {Record<string, string | number | boolean | undefined>} query */
function endpoint(path, query) {
  assertReadOnlyPath(path);
  return `${OPENAPI_BASE_URL}${path}${queryString(query)}`;
}

/** @param {string} url @param {string} token */
async function request(url, token) {
  return Promise.race([
    fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Language": API_LANGUAGE,
        Authorization: `Bearer ${token}`,
      },
    }),
    context()
      .sleep(REQUEST_TIMEOUT_MS)
      .then(() => {
        throw new Error("Longbridge API request timed out");
      }),
  ]);
}

/** @param {Response} response */
async function responseError(response) {
  const text = await response.text();
  throw new Error(`Longbridge API request failed (HTTP ${response.status}): ${text}`);
}

/**
 * Performs an authenticated, read-only GET. A 401 triggers one refresh-token
 * rotation and exactly one retry; any second 401 is returned as an error.
 *
 * @param {string} path
 * @param {Record<string, string | number | boolean | undefined>} [query]
 */
export async function get(path, query = {}) {
  const url = endpoint(path, query);
  let response = await request(url, await accessToken());
  if (response.status === 401) {
    const tokens = await refreshAccessToken();
    response = await request(url, tokens.accessToken);
  }
  if (!response.ok) await responseError(response);
  try {
    return await response.json();
  } catch (_) {
    throw new Error("Longbridge API returned invalid JSON");
  }
}

/**
 * Sends one authenticated `PUT`, to a path that is allowed to be written.
 *
 * A Longbridge write answers 200 with a code in the body, so an HTTP status is
 * not the whole answer: a refused change arrives as a successful response
 * carrying the reason, and reporting only the status would leave a rejected
 * addition looking like one that worked.
 *
 * @param {string} path
 * @param {Record<string, unknown>} body
 */
export async function put(path, body) {
  assertEditablePath(path);
  const url = `${OPENAPI_BASE_URL}${path}`;
  const send = async (token) =>
    Promise.race([
      fetch(url, {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Accept-Language": API_LANGUAGE,
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      }),
      context()
        .sleep(REQUEST_TIMEOUT_MS)
        .then(() => {
          throw new Error("Longbridge API request timed out");
        }),
    ]);
  let response = await send(await accessToken());
  if (response.status === 401) {
    const tokens = await refreshAccessToken();
    response = await send(tokens.accessToken);
  }
  if (!response.ok) await responseError(response);
  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    // A write that answers no JSON at all still answered 2xx; the caller
    // confirms what happened by reading the list back.
    return null;
  }
  if (payload && typeof payload === "object" && payload.code !== undefined && payload.code !== 0) {
    throw new Error(`Longbridge refused the change (${payload.code}): ${payload.message ?? ""}`);
  }
  return payload;
}

/** Requests the one-time password required by WebSocket command 2. */
export async function socketOtp(token) {
  const url = endpoint("/v1/socket/token", {});
  let response = await request(url, token);
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    response = await request(url, refreshed.accessToken);
  }
  if (!response.ok) await responseError(response);
  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    throw new Error("Longbridge socket token API returned invalid JSON");
  }
  if (payload && typeof payload === "object" && payload.code !== undefined && payload.code !== 0) {
    throw new Error(
      `Longbridge socket token API failed (${payload.code}): ${payload.message ?? "unknown error"}`,
    );
  }
  const data =
    payload && typeof payload === "object" && payload.data && typeof payload.data === "object"
      ? payload.data
      : payload;
  if (!data || typeof data.otp !== "string" || data.otp.length === 0) {
    throw new Error("Longbridge socket token API returned no OTP");
  }
  if (Number.isFinite(data.limit) && Number.isFinite(data.online) && data.online >= data.limit) {
    throw new Error(`Longbridge WebSocket connection limit reached (${data.online}/${data.limit})`);
  }
  return data.otp;
}
