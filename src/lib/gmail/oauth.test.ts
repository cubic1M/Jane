import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GMAIL_LIMITS, GMAIL_SCOPE, googleServer } from "@/config/gmail";
import { decrypt, encrypt } from "@/lib/crypto";
import { FakeGoogle } from "./__fixtures__/fake-google";
import { GmailGrantGoneError, GoogleCallError } from "./google";
import {
  callbackOrigin,
  exchangeCode,
  gmailSetUp,
  matchSignIn,
  refreshTokens,
  revokeTokens,
  SIGN_IN_COOKIE,
  startSignIn,
} from "./oauth";

// Signing in with Google for a mailbox: where the person is sent, what the browser keeps, trading
// the code for tokens, renewing them and asking Google to end the permission, against the fake.

const USER = "person-1";
const ORIGIN = "https://jane.example";
const NOW = new Date("2026-11-18T12:00:00Z");
const MINUTE_MS = 60 * 1000;

// What a failed call threw, for a look at its class and code.
const thrownBy = (work: Promise<unknown>): Promise<unknown> =>
  work.then(
    () => null,
    (thrown: unknown) => thrown,
  );
async function codeOf(work: Promise<unknown>): Promise<string> {
  const error = await thrownBy(work);
  expect(error).toBeInstanceOf(GoogleCallError);
  return (error as GoogleCallError).code;
}

let fake: FakeGoogle;
beforeEach(async () => {
  fake = await new FakeGoogle().start();
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("TOKEN_ENCRYPTION_KEYS", "");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("GMAIL_API_URL", fake.origin);
  vi.stubEnv("GMAIL_CLIENT_ID", fake.clientId);
  vi.stubEnv("GMAIL_CLIENT_SECRET", fake.clientSecret);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await fake.stop();
});

// What the browser kept, opened.
const inside = (cookie: string): Record<string, unknown> =>
  JSON.parse(decrypt(cookie)) as Record<string, unknown>;
const tokenCalls = () => fake.requests.filter((request) => request.path === "/token");
const revokeCalls = () => fake.requests.filter((request) => request.path === "/revoke");

// A sign-in as far as Google sending the person back: what the callback would have in hand.
async function signedIn(choice: "allow" | "deny" = "allow") {
  const { url, cookie } = startSignIn(USER, ORIGIN, "2026-11-18", { now: NOW });
  const back = new URL(await fake.signIn(url, choice));
  const signIn = matchSignIn(cookie, {
    userId: USER,
    state: back.searchParams.get("state"),
    now: NOW,
  });
  if (!signIn) throw new Error("The sign-in's own cookie didn't match");
  return { signIn, back, code: back.searchParams.get("code") ?? "" };
}

describe("whether connecting is set up", () => {
  it.each([
    ["", ""],
    ["an-id", ""],
    ["", "a-secret"],
    ["   ", "a-secret"],
    ["an-id", "  "],
  ])("isn't with the id %j and the secret %j", (id, secret) => {
    vi.stubEnv("GMAIL_CLIENT_ID", id);
    vi.stubEnv("GMAIL_CLIENT_SECRET", secret);
    expect(gmailSetUp()).toBe(false);
  });

  it("is with both", () => {
    expect(gmailSetUp()).toBe(true);
  });

  // The client Jane's own Google sign-in uses belongs to another project: at Google, ending a
  // permission ends every permission its project holds, so a mailbox connected through it would
  // take the person's way of signing in to Jane with it when it is disconnected.
  it.each([
    ["the id", { GMAIL_CLIENT_ID: "", GMAIL_CLIENT_SECRET: "a-secret" }],
    ["the secret", { GMAIL_CLIENT_ID: "an-id", GMAIL_CLIENT_SECRET: "" }],
    ["either", { GMAIL_CLIENT_ID: "", GMAIL_CLIENT_SECRET: "" }],
  ])("never falls back to the sign-in client for %s", (_what, settings) => {
    for (const [name, value] of Object.entries(settings)) vi.stubEnv(name, value);
    vi.stubEnv("AUTH_GOOGLE_ID", "sign-in-client");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "sign-in-secret");
    expect(gmailSetUp()).toBe(false);
    expect(() => startSignIn(USER, ORIGIN, "2026-11-18")).toThrow(GoogleCallError);
  });

  it("reads the client's id and secret in oauth.ts only, and the sign-in client's nowhere", () => {
    const feature = [
      "src/lib/gmail",
      "src/app/api/gmail",
      "src/app/api/cron/gmail",
      "src/app/settings/mailboxes",
    ].flatMap((dir) =>
      existsSync(dir)
        ? readdirSync(dir, { recursive: true, encoding: "utf8" })
            .map((name) => join(dir, name))
            .filter((path) => /\.tsx?$/.test(path) && !/\.test\.|__fixtures__/.test(path))
        : [],
    );
    const naming = (pattern: RegExp) =>
      feature.filter((path) => pattern.test(readFileSync(path, "utf8")));
    expect(feature).toContain("src/lib/gmail/api.ts");
    expect(naming(/GMAIL_CLIENT_(?:ID|SECRET)/)).toEqual(["src/lib/gmail/oauth.ts"]);
    expect(naming(/AUTH_GOOGLE_/)).toEqual([]);
  });
});

describe("the way back's address", () => {
  const request = new Request("https://forged.example.com/api/gmail/connect");

  it("comes from settings, never from the request, in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("AUTH_URL", "");
    vi.stubEnv("APP_URL", "");
    expect(callbackOrigin(request)).toBeNull();
    vi.stubEnv("AUTH_URL", "https://jane.example/api/auth");
    expect(callbackOrigin(request)).toBe("https://jane.example");
    vi.stubEnv("APP_URL", "https://app.jane.example");
    expect(callbackOrigin(request)).toBe("https://app.jane.example");
  });

  it("is the request's own on a developer's machine, when nothing is set", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("AUTH_URL", "");
    vi.stubEnv("APP_URL", "");
    expect(callbackOrigin(new Request("http://localhost:3000/api/gmail/connect"))).toBe(
      "http://localhost:3000",
    );
  });
});

describe("where the person is sent", () => {
  it("is Google's sign-in page, with exactly these parameters", () => {
    vi.stubEnv("GMAIL_API_URL", "");
    const { url, cookie } = startSignIn(USER, ORIGIN, "2026-11-18", { now: NOW });
    const sent = new URL(url);
    expect(`${sent.origin}${sent.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const kept = inside(cookie);
    expect(Object.fromEntries(sent.searchParams)).toEqual({
      response_type: "code",
      client_id: fake.clientId,
      redirect_uri: "https://jane.example/api/gmail/callback",
      scope: "https://www.googleapis.com/auth/gmail.readonly",
      access_type: "offline",
      prompt: "consent select_account",
      state: kept.state,
      code_challenge: createHash("sha256").update(String(kept.verifier)).digest("base64url"),
      code_challenge_method: "S256",
    });
    // No parameter twice, and none that asks for more than reading.
    expect([...sent.searchParams.keys()]).toHaveLength(9);
    expect(sent.searchParams.has("include_granted_scopes")).toBe(false);
    expect(sent.searchParams.get("scope")).toBe(GMAIL_SCOPE);
  });

  it("never carries the client's secret, the verifier or the person", () => {
    const { url, cookie } = startSignIn(USER, ORIGIN, "2026-11-18", { now: NOW });
    expect(url).not.toContain(fake.clientSecret);
    expect(url).not.toContain(String(inside(cookie).verifier));
    expect(url).not.toContain(USER);
  });

  it("is the fake's page when a fake stands in, and that page takes the request", async () => {
    const { url } = startSignIn(USER, ORIGIN, "2026-11-18", { now: NOW });
    expect(url.startsWith(`${fake.origin}/o/oauth2/v2/auth?`)).toBe(true);
    const back = new URL(await fake.signIn(url));
    expect(`${back.origin}${back.pathname}`).toBe("https://jane.example/api/gmail/callback");
    expect(back.searchParams.get("code")).toBeTruthy();
  });

  // The one path registered with Google. The fake holds to it, as Google would.
  it("is a page that takes no other way back than the callback's own path", async () => {
    const { url } = startSignIn(USER, ORIGIN, "2026-11-18", { now: NOW });
    for (const other of [
      "https://jane.example/api/gmail/back",
      "https://jane.example/api/gmail/callback?next=/elsewhere",
      "https://jane.example/api/gmail/callback/",
      "/api/gmail/callback",
    ]) {
      const changed = new URL(url);
      changed.searchParams.set("redirect_uri", other);
      await expect(fake.signIn(changed.toString()), other).rejects.toThrow("refused");
    }
  });

  it("sends a denial back with no code", async () => {
    const { back, code } = await signedIn("deny");
    expect(code).toBe("");
    expect(back.searchParams.get("error")).toBe("access_denied");
  });

  it("can't be started before the client is set up", () => {
    vi.stubEnv("GMAIL_CLIENT_SECRET", "");
    expect(() => startSignIn(USER, ORIGIN, "2026-11-18")).toThrow("Google call failed: not_set_up");
  });
});

describe("what the browser keeps", () => {
  it("is the cookie the design names", () => {
    expect(SIGN_IN_COOKIE).toBe("jane_gmail_sign_in");
  });

  it("holds what the way back needs, and says it is a Gmail sign-in", () => {
    const { cookie } = startSignIn(USER, ORIGIN, "2026-11-18", { now: NOW });
    const kept = inside(cookie);
    expect(kept).toEqual({
      for: "gmail_sign_in",
      state: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      userId: USER,
      redirectUri: "https://jane.example/api/gmail/callback",
      disclosure: "2026-11-18",
      at: NOW.getTime(),
    });
    expect(kept.state).not.toBe(kept.verifier);
  });

  it("shows none of it: the verifier stays secret", () => {
    const { cookie } = startSignIn(USER, ORIGIN, "2026-11-18", { now: NOW });
    const { verifier, state } = inside(cookie);
    expect(cookie).not.toContain(String(verifier));
    expect(cookie).not.toContain(String(state));
    expect(cookie).not.toContain(USER);
  });

  it("is new every time", () => {
    const one = inside(startSignIn(USER, ORIGIN, "2026-11-18").cookie);
    const two = inside(startSignIn(USER, ORIGIN, "2026-11-18").cookie);
    expect(one.state).not.toBe(two.state);
    expect(one.verifier).not.toBe(two.verifier);
  });
});

describe("the sign-in's cookie on the way back", () => {
  const sealed = (over: object = {}) =>
    encrypt(
      JSON.stringify({
        for: "gmail_sign_in",
        state: "the-state",
        verifier: "the-verifier",
        userId: USER,
        redirectUri: "https://jane.example/api/gmail/callback",
        disclosure: "2026-11-18",
        at: NOW.getTime(),
        ...over,
      }),
    );
  const check = (cookie: string | undefined, over: object = {}) =>
    matchSignIn(cookie, { userId: USER, state: "the-state", now: NOW, ...over });

  it("matches the person who started it, with the state that went out", () => {
    expect(check(sealed())).toMatchObject({
      verifier: "the-verifier",
      redirectUri: "https://jane.example/api/gmail/callback",
      disclosure: "2026-11-18",
    });
  });

  it("refuses another person", () => {
    expect(check(sealed(), { userId: "someone-else" })).toBeNull();
  });

  it("refuses another state, or none", () => {
    expect(check(sealed(), { state: "other-state" })).toBeNull();
    expect(check(sealed(), { state: "the-state " })).toBeNull();
    expect(check(sealed(), { state: null })).toBeNull();
    expect(check(sealed(), { state: "" })).toBeNull();
  });

  it("holds for the time a sign-in may take, and not past it", () => {
    const limit = GMAIL_LIMITS.signInMinutes * MINUTE_MS;
    expect(check(sealed(), { now: new Date(NOW.getTime() + limit - 1) })).not.toBeNull();
    expect(check(sealed(), { now: new Date(NOW.getTime() + limit) })).toBeNull();
  });

  it("refuses a missing, tampered or plain-text cookie", () => {
    expect(check(undefined)).toBeNull();
    expect(check("")).toBeNull();
    const cookie = sealed();
    const middle = Math.floor(cookie.length / 2);
    const flipped = cookie[middle] === "A" ? "B" : "A";
    expect(check(`${cookie.slice(0, middle)}${flipped}${cookie.slice(middle + 1)}`)).toBeNull();
    expect(
      check(JSON.stringify({ for: "gmail_sign_in", state: "the-state", userId: USER })),
    ).toBeNull();
  });

  // The key seals other things too. Each of these opens, and is fresh, theirs and has the state.
  it.each([
    ["a Robinhood sign-in, which says nothing of what it is for", { for: undefined }],
    ["something sealed for another purpose", { for: "gmail_connect" }],
    ["a purpose that only looks the same", { for: "gmail_sign_in " }],
    ["a sign-in with no verifier", { verifier: undefined }],
    ["a sign-in with no way back", { redirectUri: 5 }],
    ["a sign-in that doesn't say which words were shown", { disclosure: null }],
  ])("refuses %s", (_what, over) => {
    expect(check(sealed(over))).toBeNull();
  });

  it.each([
    ["nothing but null", null],
    ["a list", ["gmail_sign_in"]],
    ["a bare word", "gmail_sign_in"],
    ["a sign-in with no state", { for: "gmail_sign_in", userId: USER, at: NOW.getTime() }],
    [
      "a state that isn't text",
      { for: "gmail_sign_in", userId: USER, at: NOW.getTime(), state: 5 },
    ],
  ])("refuses, and doesn't throw, for %s sealed with the same key", (_what, value) => {
    expect(check(encrypt(JSON.stringify(value)))).toBeNull();
  });
});

describe("trading the code for tokens", () => {
  it("works with the verifier, the way back and the secret that belong to it", async () => {
    const { signIn, code } = await signedIn();
    const tokens = await exchangeCode(signIn, code, { now: NOW });
    expect(tokens.accessToken).toMatch(/^fake-access-/);
    expect(tokens.refreshToken).toMatch(/^fake-refresh-/);
    expect(tokens.expiresAt).toEqual(new Date(NOW.getTime() + 3599 * 1000));
    expect(tokenCalls().map((request) => request.form)).toEqual([
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: "https://jane.example/api/gmail/callback",
        code_verifier: signIn.verifier,
        client_id: fake.clientId,
        client_secret: fake.clientSecret,
      },
    ]);
  });

  it("puts the secret and the code in the body, never in the address", async () => {
    const { signIn, code } = await signedIn();
    await exchangeCode(signIn, code);
    expect(tokenCalls().map(({ method, query }) => ({ method, query }))).toEqual([
      { method: "POST", query: "" },
    ]);
  });

  it("the fake refuses a wrong verifier, way back or secret, so these tests would notice one", async () => {
    const { signIn, code } = await signedIn();
    expect(await codeOf(exchangeCode({ ...signIn, verifier: "wrong" }, code))).toBe("grant");
    expect(
      await codeOf(exchangeCode({ ...signIn, redirectUri: "https://evil.example/back" }, code)),
    ).toBe("grant");
    vi.stubEnv("GMAIL_CLIENT_SECRET", "wrong-secret");
    expect(await codeOf(exchangeCode(signIn, code))).toBe("client");
    vi.stubEnv("GMAIL_CLIENT_SECRET", fake.clientSecret);
    expect((await exchangeCode(signIn, code)).accessToken).toMatch(/^fake-access-/);
  });

  // The class that means "connect again" is for a mailbox whose permission is gone. A spent code
  // is this one sign-in failing, and must never take a working mailbox with it.
  it("calls a code used twice a failed sign-in, never a permission that is gone", async () => {
    const { signIn, code } = await signedIn();
    await exchangeCode(signIn, code);
    const error = await thrownBy(exchangeCode(signIn, code));
    expect(error).toBeInstanceOf(GoogleCallError);
    expect(error).not.toBeInstanceOf(GmailGrantGoneError);
    expect((error as GoogleCallError).code).toBe("grant");
  });

  it.each([
    "",
    "openid email",
    "https://www.googleapis.com/auth/gmail.metadata",
    `${GMAIL_SCOPE}.extra`,
    `${GMAIL_SCOPE}/more`,
    `extra-${GMAIL_SCOPE}`,
    `openid,${GMAIL_SCOPE}`,
    GMAIL_SCOPE.toUpperCase(),
  ])("refuses tokens that don't carry the permission to read: %j", async (granted) => {
    fake.options.grantedScope = granted;
    const { signIn, code } = await signedIn();
    expect(await codeOf(exchangeCode(signIn, code))).toBe("scope");
  });

  it.each([GMAIL_SCOPE, `openid ${GMAIL_SCOPE} email`, `${GMAIL_SCOPE} openid`])(
    "takes the permission as a whole word among others: %j",
    async (granted) => {
      fake.options.grantedScope = granted;
      const { signIn, code } = await signedIn();
      expect((await exchangeCode(signIn, code)).refreshToken).toMatch(/^fake-refresh-/);
    },
  );

  it("refuses tokens that come without a way to renew them", async () => {
    fake.options.noRefreshToken = true;
    const { signIn, code } = await signedIn();
    expect(await codeOf(exchangeCode(signIn, code))).toBe("no_refresh");
  });

  // Which mailbox the tokens are for isn't known yet, and at Google one revoke ends every
  // permission the project holds for that account: a mailbox that was working would go with it.
  it("revokes nothing itself, whatever went wrong", async () => {
    fake.options.grantedScope = "openid";
    const scope = await signedIn();
    await codeOf(exchangeCode(scope.signIn, scope.code));
    fake.options.grantedScope = undefined;
    fake.options.noRefreshToken = true;
    const noRefresh = await signedIn();
    await codeOf(exchangeCode(noRefresh.signIn, noRefresh.code));
    await codeOf(exchangeCode(noRefresh.signIn, noRefresh.code));
    fake.answerWith("/token", 500);
    const broken = await signedIn();
    await codeOf(exchangeCode(broken.signIn, broken.code));
    expect(fake.revokedTokens).toEqual([]);
    expect(revokeCalls()).toEqual([]);
  });

  it("asks once, even when Google is having trouble", async () => {
    fake.answerWith("/token", 503, { times: 5 });
    const { signIn, code } = await signedIn();
    expect(await codeOf(exchangeCode(signIn, code))).toBe("token_http_503");
    expect(tokenCalls()).toHaveLength(1);
  });

  it("sends nothing when the client isn't set up", async () => {
    const { signIn, code } = await signedIn();
    vi.stubEnv("GMAIL_CLIENT_SECRET", "");
    expect(await codeOf(exchangeCode(signIn, code))).toBe("not_set_up");
    expect(tokenCalls()).toEqual([]);
  });
});

describe("renewing the access token", () => {
  // Whether the fake's Gmail takes a token.
  const taken = async (accessToken: string) =>
    (
      await fetch(`${googleServer().api}/profile`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    ).status === 200;

  it("brings a new access token, which is the one Gmail then takes", async () => {
    const first = fake.issueTokensForTest();
    const tokens = await refreshTokens(first.refreshToken, { now: NOW });
    expect(tokens.accessToken).not.toBe(first.accessToken);
    expect(tokens.expiresAt).toEqual(new Date(NOW.getTime() + 3599 * 1000));
    expect(await taken(tokens.accessToken)).toBe(true);
    expect(await taken(first.accessToken)).toBe(false);
    expect(tokenCalls().map((request) => request.form)).toEqual([
      {
        grant_type: "refresh_token",
        refresh_token: first.refreshToken,
        client_id: fake.clientId,
        client_secret: fake.clientSecret,
      },
    ]);
  });

  it("keeps the refresh token when Google sends no new one, and keeps working with it", async () => {
    const { refreshToken } = fake.issueTokensForTest();
    const once = await refreshTokens(refreshToken);
    expect(once.refreshToken).toBe(refreshToken);
    const twice = await refreshTokens(once.refreshToken ?? "");
    expect(twice.refreshToken).toBe(refreshToken);
    expect(await taken(twice.accessToken)).toBe(true);
  });

  it("takes a new refresh token when Google sends one", async () => {
    fake.options.newRefreshTokens = true;
    const { refreshToken } = fake.issueTokensForTest();
    const tokens = await refreshTokens(refreshToken);
    expect(tokens.refreshToken).toMatch(/^fake-refresh-/);
    expect(tokens.refreshToken).not.toBe(refreshToken);
  });

  it("says the permission is gone when Google says invalid_grant", async () => {
    const { refreshToken } = fake.issueTokensForTest();
    fake.takeBack();
    expect(await thrownBy(refreshTokens(refreshToken))).toBeInstanceOf(GmailGrantGoneError);
    expect(await thrownBy(refreshTokens("never-a-token"))).toBeInstanceOf(GmailGrantGoneError);
  });

  // A wrong or removed client secret fails every mailbox at once. Read as "permission gone", it
  // would wipe every mailbox's tokens and make every person connect again.
  it("tells Jane's own client being refused from a permission that is gone", async () => {
    const { refreshToken } = fake.issueTokensForTest();
    vi.stubEnv("GMAIL_CLIENT_SECRET", "wrong-secret");
    const error = await thrownBy(refreshTokens(refreshToken));
    expect(error).not.toBeInstanceOf(GmailGrantGoneError);
    expect((error as GoogleCallError).code).toBe("client");
  });

  it.each([
    [500, undefined, "token_http_500"],
    [503, undefined, "token_http_503"],
    [400, { error: "invalid_request" }, "token_http_400"],
    [401, { error: "unauthorized_client" }, "token_http_401"],
    [403, { error: { code: 403, message: "invalid_grant" } }, "token_http_403"],
    [400, { error_description: "invalid_grant" }, "token_http_400"],
  ])(
    "calls a %i that isn't either of those a failed call, to try again later",
    async (status, body, code) => {
      const { refreshToken } = fake.issueTokensForTest();
      fake.answerWith("/token", status, { body });
      const error = await thrownBy(refreshTokens(refreshToken));
      expect(error).not.toBeInstanceOf(GmailGrantGoneError);
      expect((error as GoogleCallError).code).toBe(code);
    },
  );

  it("asks once, even when Google is having trouble", async () => {
    const { refreshToken } = fake.issueTokensForTest();
    fake.answerWith("/token", 500, { times: 5 });
    await thrownBy(refreshTokens(refreshToken));
    expect(tokenCalls()).toHaveLength(1);
  });
});

describe("asking Google to end the permission", () => {
  it("puts the token in the form's body, never in the address", async () => {
    const { refreshToken } = fake.issueTokensForTest();
    expect(await revokeTokens([refreshToken])).toBe(true);
    expect(fake.revokedTokens).toEqual([refreshToken]);
    expect(revokeCalls()).toMatchObject([
      { method: "POST", query: "", form: { token: refreshToken }, bearer: null, status: 200 },
    ]);
    // Nothing but the token: the client's secret isn't needed, so it isn't sent.
    expect(Object.keys(revokeCalls()[0].form)).toEqual(["token"]);
  });

  it("ends it: the token no longer renews", async () => {
    const { refreshToken } = fake.issueTokensForTest();
    await revokeTokens([refreshToken]);
    expect(await thrownBy(refreshTokens(refreshToken))).toBeInstanceOf(GmailGrantGoneError);
  });

  // Google's rule, which the fake keeps: this is why Jane asks only when no active mailbox holds
  // the address.
  it("ends every permission for that account, not only the token's own", async () => {
    const mine = fake.issueTokensForTest("shared@fake-mailbox.test");
    const theirs = fake.issueTokensForTest("Shared@fake-mailbox.test");
    const another = fake.issueTokensForTest("another@fake-mailbox.test");
    expect(await revokeTokens([mine.accessToken])).toBe(true);
    expect(await thrownBy(refreshTokens(theirs.refreshToken))).toBeInstanceOf(GmailGrantGoneError);
    expect((await refreshTokens(another.refreshToken)).accessToken).toMatch(/^fake-access-/);
  });

  it("is true only if Google took every token", async () => {
    const one = fake.issueTokensForTest("one@fake-mailbox.test");
    const two = fake.issueTokensForTest("two@fake-mailbox.test");
    expect(await revokeTokens([one.refreshToken, "never-a-token"])).toBe(false);
    expect(await revokeTokens(["never-a-token", two.refreshToken])).toBe(false);
    // The one after a refusal was still sent.
    expect(await thrownBy(refreshTokens(two.refreshToken))).toBeInstanceOf(GmailGrantGoneError);
    expect(await revokeTokens([])).toBe(false);
  });

  it("asks once for each token, even when Google is having trouble", async () => {
    fake.answerWith("/revoke", 503, { times: 5 });
    expect(await revokeTokens([fake.issueTokensForTest().refreshToken])).toBe(false);
    expect(revokeCalls()).toHaveLength(1);
  });

  it("never throws: not for a redirect, a cut connection, a server that is gone or a bad setting", async () => {
    const { refreshToken } = fake.issueTokensForTest();
    fake.options.redirectTo = "https://evil.example/steal";
    expect(await revokeTokens([refreshToken])).toBe(false);
    fake.options.redirectTo = undefined;
    fake.hangUp("/revoke");
    expect(await revokeTokens([refreshToken])).toBe(false);
    await fake.stop();
    expect(await revokeTokens([refreshToken])).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("no network");
      }),
    );
    expect(await revokeTokens([refreshToken])).toBe(false);
  });

  it("needs no client set up: disconnecting works after the settings are gone", async () => {
    const { refreshToken } = fake.issueTokensForTest();
    vi.stubEnv("GMAIL_CLIENT_ID", "");
    vi.stubEnv("GMAIL_CLIENT_SECRET", "");
    expect(await revokeTokens([refreshToken])).toBe(true);
  });
});

describe("what an error may carry", () => {
  // The fake's error answers repeat everything they were sent.
  it("is none of the server's words, and no token, code or secret", async () => {
    const { refreshToken } = fake.issueTokensForTest();
    fake.answerWith("/token", 500);
    const failed = await thrownBy(refreshTokens(refreshToken));
    fake.takeBack();
    const gone = await thrownBy(refreshTokens(refreshToken));
    const { signIn, code } = await signedIn();
    await exchangeCode(signIn, code);
    const spent = await thrownBy(exchangeCode(signIn, code));
    for (const error of [failed, gone, spent]) {
      const said = `${String(error)} ${JSON.stringify(error)} ${(error as Error).stack}`;
      for (const secret of [refreshToken, code, signIn.verifier, fake.clientSecret]) {
        expect(said).not.toContain(secret);
      }
      expect(said).not.toMatch(/server_error|invalid_grant|Refused/);
    }
    expect(String(failed)).toBe("GoogleCallError: Google call failed: token_http_500");
    expect(String(gone)).toBe("GmailGrantGoneError: Google no longer accepts this connection.");
    expect(String(spent)).toBe("GoogleCallError: Google call failed: grant");
  });
});

// A hostile or broken server at the token address.
describe("an answer that isn't what a token answer should be", () => {
  const answering = (body: unknown, status = 200) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status })),
    );
  const good = { access_token: "an-access-token", refresh_token: "r", scope: GMAIL_SCOPE };
  const signIn = { redirectUri: `${ORIGIN}/api/gmail/callback`, verifier: "v" };

  // Not "too_large": a renewal runs inside a message fetch, and there that code means the one
  // email (./api.test.ts). Read to its end, this answer would be "not_json".
  it("isn't read into memory when it is huge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(" ".repeat(GMAIL_LIMITS.signInAnswerBytes + 1))),
    );
    expect(await codeOf(exchangeCode(signIn, "code"))).toBe("token_answer");
    expect(await codeOf(refreshTokens("r"))).toBe("token_answer");
  });

  it("isn't taken when it isn't JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>Sign in</html>")),
    );
    expect(await codeOf(exchangeCode(signIn, "code"))).toBe("not_json");
  });

  it.each(["a\u0000b", "new\nline", "é", "x".repeat(20_000), "", 5, null, ["a"]])(
    "is refused for an access token that isn't one: %j",
    async (access_token) => {
      answering({ ...good, access_token });
      expect(await codeOf(exchangeCode(signIn, "code"))).toBe("token_answer");
      expect(await codeOf(refreshTokens("r"))).toBe("token_answer");
    },
  );

  it("drops a refresh token that isn't one", async () => {
    answering({ ...good, refresh_token: "r\u0000" });
    expect(await codeOf(exchangeCode(signIn, "code"))).toBe("no_refresh");
    expect((await refreshTokens("the-one-in-hand")).refreshToken).toBe("the-one-in-hand");
  });

  it("keeps no lifetime it couldn't save", async () => {
    for (const expires_in of [1e300, 1e15, 0, -5, "3600", null]) {
      answering({ ...good, expires_in });
      expect((await exchangeCode(signIn, "code", { now: NOW })).expiresAt).toBeNull();
    }
    answering({ ...good, expires_in: 3600 });
    expect((await exchangeCode(signIn, "code", { now: new Date(0) })).expiresAt).toEqual(
      new Date(3_600_000),
    );
  });

  it("isn't the permission when the scope isn't text", async () => {
    for (const scope of [undefined, null, 5, [GMAIL_SCOPE], { scope: GMAIL_SCOPE }]) {
      answering({ ...good, scope });
      expect(await codeOf(exchangeCode(signIn, "code"))).toBe("scope");
    }
  });

  it("goes to the token address only, with no redirect followed and no copy kept", async () => {
    vi.stubEnv("GMAIL_API_URL", "");
    const sent = vi.fn(
      async (..._request: [string, RequestInit]) => new Response(JSON.stringify(good)),
    );
    vi.stubGlobal("fetch", sent);
    await exchangeCode(signIn, "code");
    await refreshTokens("r");
    await revokeTokens(["t"]);
    expect(sent.mock.calls.map(([address]) => address)).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://oauth2.googleapis.com/token",
      "https://oauth2.googleapis.com/revoke",
    ]);
    for (const [, init] of sent.mock.calls) {
      expect(init.redirect).toBe("error");
      expect(init.cache).toBe("no-store");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });
});
