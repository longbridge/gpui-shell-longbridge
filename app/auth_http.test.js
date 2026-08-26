// A network-free shell contract for the real auth.js and http.js modules.

import { View, sleep, spawn, text, v_flex, with_cx } from "gpui";
import { beginDeviceAuthorization, formBody, pollDeviceAuthorization } from "./auth.js";
import { get, socketOtp } from "./http.js";

// Keep the read-only HTTP module imported: a broken relative import is a
// startup failure, while this expression never invokes it.
void get;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function authorization() {
  return {
    deviceCode: "shared-device-code",
    verificationUri: "https://example.test/device",
    userCode: "ABCD-EFGH",
    intervalMs: 1_000,
    expiresAt: 60_000,
  };
}

async function createDeviceCodeOnAp() {
  const calls = [];
  const result = await beginDeviceAuthorization({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response(200, {
        device_code: "shared-device-code",
        verification_uri_complete: "https://example.test/device?code=ABCD-EFGH",
        user_code: "ABCD-EFGH",
        interval: 1,
        expires_in: 60,
      });
    },
    now: () => 0,
  });
  check(calls.length === 1, "device code is created once");
  check(
    calls[0].url.endsWith("/oauth2/device/authorize"),
    "device code uses the AP authorize endpoint",
  );
  check(
    !("x-dc-region" in calls[0].options.headers),
    "AP device-code creation has no region override",
  );
  check(
    result.deviceCode === "shared-device-code" && result.expiresAt === 60_000,
    "device authorization is returned",
  );
}

async function usAuthorizationCanWin() {
  const regions = [];
  const saved = [];
  const tokens = await pollDeviceAuthorization(authorization(), {
    fetch: async (_url, options) => {
      const region = options.headers["x-dc-region"];
      regions.push(region);
      return region === "us"
        ? response(200, {
            access_token: "us_access",
            refresh_token: "us_refresh",
            expires_in: 3600,
          })
        : response(400, { error: "authorization_pending" });
    },
    sleep: async () => {},
    now: () => 0,
    saveTokens: async (value) => saved.push(value),
  });
  check(regions.join(",") === "ap,us", "each round polls AP and US with explicit region headers");
  check(tokens.accessToken === "us_access", "US authorization wins");
  check(
    saved.length === 1 && saved[0].refreshToken === "us_refresh",
    "winning tokens are saved once",
  );
}

async function slowDownIsSharedOncePerRound() {
  const sleeps = [];
  let round = 0;
  const tokens = await pollDeviceAuthorization(authorization(), {
    fetch: async (_url, options) => {
      const region = options.headers["x-dc-region"];
      if (region === "ap") round += 1;
      if (round === 1) return response(400, { error: "slow_down" });
      return region === "us"
        ? response(200, {
            access_token: "us_after_slow_down",
            refresh_token: "us_refresh",
            expires_in: 3600,
          })
        : response(400, { error: "authorization_pending" });
    },
    sleep: async (delay) => sleeps.push(delay),
    now: () => 0,
    saveTokens: async () => {},
  });
  check(tokens.accessToken === "us_after_slow_down", "polling continues after slow_down");
  check(sleeps.join(",") === "1000,6000", "slow_down increases the shared interval once per round");
}

async function transientRegionDoesNotAbortItsSibling() {
  let round = 0;
  const tokens = await pollDeviceAuthorization(authorization(), {
    fetch: async (_url, options) => {
      const region = options.headers["x-dc-region"];
      if (region === "ap") round += 1;
      if (round === 1) {
        return region === "ap"
          ? response(503, { error: "server_error" })
          : response(400, { error: "authorization_pending" });
      }
      return region === "us"
        ? response(200, {
            access_token: "eventual_access",
            refresh_token: "eventual_refresh",
            expires_in: 3600,
          })
        : response(400, { error: "authorization_pending" });
    },
    sleep: async () => {},
    now: () => 0,
    saveTokens: async () => {},
  });
  check(
    tokens.accessToken === "eventual_access",
    "transient and pending responses keep both-region polling alive",
  );
}

async function permanentOauthErrorTerminates() {
  let error = null;
  try {
    await pollDeviceAuthorization(authorization(), {
      fetch: async (_url, options) =>
        options.headers["x-dc-region"] === "ap"
          ? response(400, { error: "invalid_grant" })
          : response(400, { error: "authorization_pending" }),
      sleep: async () => {},
      now: () => 0,
      saveTokens: async () => {},
    });
  } catch (caught) {
    error = caught;
  }
  check(
    error && error.message.includes("invalid_grant"),
    "permanent OAuth rejection terminates polling",
  );
}

// Longbridge returns security names in the language the request asks for, so an
// authenticated read must pin English rather than inherit the account default.
async function authenticatedReadsRequestEnglish() {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ code: 0, data: { otp: "one-time" } });
      },
      async json() {
        return { code: 0, data: { otp: "one-time" } };
      },
    };
  };
  try {
    await socketOtp("test-token");
  } finally {
    globalThis.fetch = original;
  }
  check(calls.length === 1, "socket token is fetched once");
  check(
    calls[0].options.headers["Accept-Language"] === "en",
    "authenticated Longbridge reads request English content",
  );
}

async function runVectors() {
  check(
    formBody({ client_id: "public client", grant_type: "refresh_token" }) ===
      "client_id=public+client&grant_type=refresh_token",
    "form encoding",
  );
  await createDeviceCodeOnAp();
  await usAuthorizationCanWin();
  await slowDownIsSharedOncePerRound();
  await transientRegionDoesNotAbortItsSibling();
  await permanentOauthErrorTerminates();
  await authenticatedReadsRequestEnglish();
}

export default class AuthHttpContract extends View {
  init() {
    this.result = "pending";
    spawn(async () => {
      try {
        await sleep(0);
        await runVectors();
        this.result = "ok";
      } catch (error) {
        this.result = `failed:${error.message}`;
      }
      with_cx((cx) => cx.notify());
    });
  }

  render() {
    return v_flex().child(text(this.result));
  }
}
