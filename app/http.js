// The Longbridge REST boundary. Only authenticated GET is exposed here: OAuth
// owns the two necessary form POSTs in auth.js, and no order-writing method is
// available from this module.

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
  "/v1/watchlist/groups",
]);

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

/** @param {import("gpui").AsyncContext} cx @param {string} url @param {string} token */
async function request(cx, url, token) {
  return Promise.race([
    fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Language": API_LANGUAGE,
        Authorization: `Bearer ${token}`,
      },
    }),
    cx.sleep(REQUEST_TIMEOUT_MS).then(() => {
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
 * The timeout is a race against `cx.sleep`, so this takes the `AsyncContext`
 * of whatever task is doing the reading rather than reaching for an ambient
 * one: a read belongs to the task that asked for it.
 *
 * @param {import("gpui").AsyncContext} cx
 * @param {string} path
 * @param {Record<string, string | number | boolean | undefined>} [query]
 */
export async function get(cx, path, query = {}) {
  const url = endpoint(path, query);
  let response = await request(cx, url, await accessToken());
  if (response.status === 401) {
    const tokens = await refreshAccessToken();
    response = await request(cx, url, tokens.accessToken);
  }
  if (!response.ok) await responseError(response);
  try {
    return await response.json();
  } catch (_) {
    throw new Error("Longbridge API returned invalid JSON");
  }
}

/**
 * Requests the one-time password required by WebSocket command 2.
 *
 * @param {import("gpui").AsyncContext} cx
 * @param {string} token
 */
export async function socketOtp(cx, token) {
  const url = endpoint("/v1/socket/token", {});
  let response = await request(cx, url, token);
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    response = await request(cx, url, refreshed.accessToken);
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
