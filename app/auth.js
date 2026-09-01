// Longbridge OAuth 2.0 public-client support. This module intentionally has no
// dynamic client registration: register this application once out-of-band and
// replace CLIENT_ID with that public identifier before distributing it.

import { context } from "./context.js";

/**
 * The one, fixed public-client identifier for this application.
 *
 * Registered once as "Longbridge Lite", a public client with no secret,
 * granting the device-code and refresh-token flows -- the two this file
 * implements. Replacing it invalidates every stored refresh token, since a
 * token belongs to the client it was issued to, so the next start asks each
 * reader to authorize again.
 *
 * Never add dynamic registration or a client secret here. Registration is an
 * out-of-band step whose management credential does not belong in a
 * distributed application.
 */
export const CLIENT_ID = "7426157d-3e7b-4c33-9c18-1ecf32d2d114";

export const OPENAPI_BASE_URL = "https://openapi.longbridge.com";
export const OAUTH_BASE_URL = `${OPENAPI_BASE_URL}/oauth2`;

const TOKEN_STORE_KEY = "longbridge.oauth.tokens.v1";
const EXPIRY_SKEW_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

/** @typedef {{ accessToken: string, refreshToken: string, expiresAt: number }} Tokens */
/** @typedef {{ deviceCode: string, verificationUri: string, userCode: string, intervalMs: number, expiresAt: number }} DeviceAuthorization */

function configuredClientId() {
  if (CLIENT_ID.startsWith("REPLACE_WITH_")) {
    throw new Error(
      "Longbridge CLIENT_ID is not configured; register this public client once and replace the CLIENT_ID constant in auth.js",
    );
  }
  return CLIENT_ID;
}

/** @param {string} value */
function formComponent(value) {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

/** @param {Record<string, string>} fields */
export function formBody(fields) {
  return Object.entries(fields)
    .map(([key, value]) => `${formComponent(key)}=${formComponent(value)}`)
    .join("&");
}

/**
 * How long an OAuth request may take before it is treated as lost.
 *
 * `http.js` bounds its API requests the same way and for the same reason, but
 * this file did not, and the difference was not academic: `get` refreshes the
 * token on a 401 and retries, so a refresh that never answered left the window
 * on "Loading watchlist" with no error, no log and no end -- the request was
 * still outstanding, so nothing had failed yet. It stayed that way for as long
 * as the window was open.
 */
const OAUTH_TIMEOUT_MS = 15_000;

/** @param {string} endpoint @param {Record<string, string>} fields @param {Record<string, string>} [extraHeaders] @param {typeof fetch} [fetchImpl] */
async function postForm(endpoint, fields, extraHeaders = {}, fetchImpl = fetch) {
  const sent = fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      ...extraHeaders,
    },
    body: formBody(fields),
  });
  const response = await Promise.race([
    sent,
    context()
      .sleep(OAUTH_TIMEOUT_MS)
      .then(() => {
        throw new Error("Longbridge OAuth request timed out");
      }),
  ]);
  const body = await response.text();
  let json;
  try {
    json = JSON.parse(body);
  } catch (_) {
    json = null;
  }
  if (!response.ok) {
    const code = json && typeof json.error === "string" ? json.error : `HTTP ${response.status}`;
    throw new Error(`Longbridge OAuth request failed: ${code}`);
  }
  if (!json || typeof json !== "object") {
    throw new Error("Longbridge OAuth response was not JSON");
  }
  return json;
}

/** @param {unknown} value @returns {Tokens | null} */
function tokensFromStore(value) {
  if (!value || typeof value !== "object") return null;
  const token =
    /** @type {{ accessToken?: unknown, refreshToken?: unknown, expiresAt?: unknown }} */ (value);
  if (
    typeof token.accessToken !== "string" ||
    typeof token.refreshToken !== "string" ||
    typeof token.expiresAt !== "number"
  ) {
    return null;
  }
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
  };
}

/** @returns {Tokens | null} */
export function loadTokens() {
  const saved = localStorage.getItem(TOKEN_STORE_KEY);
  if (saved === null) return null;
  try {
    return tokensFromStore(JSON.parse(saved));
  } catch {
    // A value that will not parse means the same thing as one that parses to
    // the wrong shape: not signed in. Throwing here would take the window down
    // at startup over a file the user cannot see.
    return null;
  }
}

/** @param {Tokens} tokens */
export async function saveTokens(tokens) {
  localStorage.setItem(TOKEN_STORE_KEY, JSON.stringify(tokens));
  // Token rotation must be durable before a caller starts using the new access
  // token: otherwise a crash would strand the previous refresh token.
  await localStorage.flush();
}

export async function clearTokens() {
  localStorage.removeItem(TOKEN_STORE_KEY);
  await localStorage.flush();
}

/**
 * Starts RFC 8628 device authorization. It sends no registration request and
 * returns immediately so the UI can show the verification URL and user code.
 *
 * @returns {Promise<DeviceAuthorization>}
 */
export async function beginDeviceAuthorization(dependencies = {}) {
  const json = await postForm(
    `${OAUTH_BASE_URL}/device/authorize`,
    {
      client_id: configuredClientId(),
    },
    {},
    dependencies.fetch,
  );
  if (typeof json.device_code !== "string" || typeof json.expires_in !== "number") {
    throw new Error("Longbridge device authorization response was incomplete");
  }
  const verificationUri =
    typeof json.verification_uri_complete === "string"
      ? json.verification_uri_complete
      : json.verification_uri;
  if (typeof verificationUri !== "string") {
    throw new Error("Longbridge device authorization omitted verification_uri");
  }
  return {
    deviceCode: json.device_code,
    verificationUri,
    userCode: typeof json.user_code === "string" ? json.user_code : "",
    intervalMs: Math.max(1, typeof json.interval === "number" ? json.interval : 5) * 1_000,
    expiresAt: (dependencies.now || Date.now)() + json.expires_in * 1_000,
  };
}

/** @param {unknown} json @returns {Tokens} */
function tokensFromResponse(json, fallbackRefreshToken, now = Date.now) {
  if (!json || typeof json !== "object" || typeof json.access_token !== "string") {
    throw new Error("Longbridge token response omitted access_token");
  }
  const response =
    /** @type {{ access_token: string, refresh_token?: unknown, expires_in?: unknown }} */ (json);
  const refreshToken =
    typeof response.refresh_token === "string" ? response.refresh_token : fallbackRefreshToken;
  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    throw new Error("Longbridge token response omitted refresh_token");
  }
  return {
    accessToken: response.access_token,
    refreshToken,
    expiresAt:
      now() + (typeof response.expires_in === "number" ? response.expires_in : 3600) * 1_000,
  };
}

const TERMINAL_DEVICE_ERRORS = new Set([
  "access_denied",
  "expired_token",
  "invalid_client",
  "invalid_grant",
]);

async function pollDeviceRegion(authorization, clientId, region, fetchImpl, now) {
  try {
    const response = await fetchImpl(`${OAUTH_BASE_URL}/token`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "x-dc-region": region,
      },
      body: formBody({
        client_id: clientId,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: authorization.deviceCode,
      }),
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (_) {
      return { kind: "transient" };
    }
    if (response.ok) {
      try {
        return { kind: "success", tokens: tokensFromResponse(json, "", now) };
      } catch (_) {
        return { kind: "transient" };
      }
    }
    const code = json && typeof json.error === "string" ? json.error : `HTTP ${response.status}`;
    return { kind: "oauth", code };
  } catch (_) {
    return { kind: "transient" };
  }
}

/**
 * Polls until the reader authorizes, rejects, or the device code expires.
 * `slow_down` increases the interval for subsequent polls as RFC 8628 requires.
 *
 * @param {DeviceAuthorization} authorization
 * @returns {Promise<Tokens>}
 */
export async function pollDeviceAuthorization(authorization, dependencies = {}) {
  const clientId = configuredClientId();
  const fetchImpl = dependencies.fetch || fetch;
  const sleepImpl = dependencies.sleep || /** @param {number} ms */ ((ms) => context().sleep(ms));
  const now = dependencies.now || Date.now;
  const save = dependencies.saveTokens || saveTokens;
  const shouldCancel = dependencies.shouldCancel || (() => false);
  let intervalMs = authorization.intervalMs || DEFAULT_POLL_INTERVAL_MS;
  while (now() < authorization.expiresAt) {
    if (shouldCancel()) throw new Error("authorization_cancelled");
    await sleepImpl(intervalMs);
    if (shouldCancel()) throw new Error("authorization_cancelled");
    const results = await Promise.all([
      pollDeviceRegion(authorization, clientId, "ap", fetchImpl, now),
      pollDeviceRegion(authorization, clientId, "us", fetchImpl, now),
    ]);
    const success = results.find((result) => result.kind === "success");
    if (success) {
      const tokens = success.tokens;
      if (shouldCancel()) throw new Error("authorization_cancelled");
      await save(tokens);
      return tokens;
    }
    const terminal = results.find(
      (result) => result.kind === "oauth" && TERMINAL_DEVICE_ERRORS.has(result.code),
    );
    if (terminal) {
      throw new Error(`Longbridge device authorization failed: ${terminal.code}`);
    }
    if (results.some((result) => result.kind === "oauth" && result.code === "slow_down")) {
      intervalMs += 5_000;
    }
  }
  throw new Error("Longbridge device authorization expired");
}

/** @param {string} refreshToken */
function dataCenterFor(refreshToken) {
  return refreshToken.startsWith("us_") ? "us" : "ap";
}

/**
 * The rotation in flight, if one is.
 *
 * Longbridge rotates the refresh token on every use: the answer carries a new
 * one and retires the one that asked. So two callers that discover an expired
 * access token together and each ask on their own retire each other's token,
 * and whichever lands second is signing in with a credential that no longer
 * exists. Callers used to avoid that by never reading in parallel, which cost
 * every page the sum of its requests rather than the longest of them. The
 * rotation is deduplicated here instead, so parallel reads are simply safe.
 *
 * @type {Promise<Tokens> | null}
 */
let rotating = null;

/** @param {Tokens | null} existing */
export async function refreshAccessToken(existing = loadTokens()) {
  if (rotating) return rotating;
  rotating = rotateAccessToken(existing).finally(() => {
    rotating = null;
  });
  return rotating;
}

/** @param {Tokens | null} existing */
async function rotateAccessToken(existing) {
  if (!existing) throw new Error("Longbridge sign-in is required");
  const json = await postForm(
    `${OAUTH_BASE_URL}/token`,
    {
      client_id: configuredClientId(),
      grant_type: "refresh_token",
      refresh_token: existing.refreshToken,
    },
    { "x-dc-region": dataCenterFor(existing.refreshToken) },
  );
  const tokens = tokensFromResponse(json, existing.refreshToken);
  await saveTokens(tokens);
  return tokens;
}

/** Returns a usable token, refreshing it shortly before expiry. */
export async function accessToken() {
  const tokens = loadTokens();
  if (!tokens) throw new Error("Longbridge sign-in is required");
  if (tokens.expiresAt <= Date.now() + EXPIRY_SKEW_MS) {
    return (await refreshAccessToken(tokens)).accessToken;
  }
  return tokens.accessToken;
}
