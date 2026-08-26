// The Longbridge REST boundary. Only authenticated GET is exposed here: OAuth
// owns the two necessary form POSTs in auth.js, and no order-writing method is
// available from this module.

import { OPENAPI_BASE_URL, accessToken, refreshAccessToken } from "./auth.js";

const READ_ONLY_PREFIXES = ["/v1/quote/"];
const READ_ONLY_PATHS = new Set([
  "/v1/asset/account",
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

/** @param {string} url @param {string} token */
async function request(url, token) {
  return fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
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
