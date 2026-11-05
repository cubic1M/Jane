import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/lib/crypto";
import { FakeRobinhood } from "./__fixtures__/fake-robinhood";
import {
  callbackOrigin,
  exchangeCode,
  forgetMetadataForTests,
  loadMetadata,
  matchSignIn,
  refreshTokens,
  revokeTokens,
  RobinhoodGrantGoneError,
  RobinhoodOAuthError,
} from "./oauth";

const USER = "person-1";
const signIn = (over: object = {}) =>
  encrypt(
    JSON.stringify({
      state: "the-state",
      verifier: "the-verifier",
      clientId: "client",
      userId: USER,
      redirectUri: "http://localhost/back",
      at: 1_000_000,
      ...over,
    }),
  );

describe("the sign-in's cookie", () => {
  beforeEach(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64"));
  });
  afterEach(() => vi.unstubAllEnvs());

  const check = (cookie: string | undefined, over: object = {}) =>
    matchSignIn(cookie, { userId: USER, state: "the-state", now: 1_000_001, ...over });

  it("matches the person who started it, with the state that went out", () => {
    expect(check(signIn())?.verifier).toBe("the-verifier");
  });
  it("refuses another person", () => {
    expect(check(signIn(), { userId: "someone-else" })).toBeNull();
  });
  it("refuses another state, or none", () => {
    expect(check(signIn(), { state: "other-state" })).toBeNull();
    expect(check(signIn(), { state: null })).toBeNull();
  });
  it("refuses one past the time limit", () => {
    expect(check(signIn(), { now: 1_000_000 + 11 * 60 * 1000 })).toBeNull();
  });
  it("refuses a missing, tampered or plain-text cookie", () => {
    expect(check(undefined)).toBeNull();
    const sealed = signIn();
    const middle = Math.floor(sealed.length / 2);
    const flipped = sealed[middle] === "A" ? "B" : "A";
    expect(check(`${sealed.slice(0, middle)}${flipped}${sealed.slice(middle + 1)}`)).toBeNull();
    expect(check(JSON.stringify({ state: "the-state", userId: USER, at: 1_000_000 }))).toBeNull();
  });
});

describe("the way back's address", () => {
  afterEach(() => vi.unstubAllEnvs());
  const request = new Request("https://forged.example.com/api/robinhood/connect");

  it("comes from settings, never from the request, in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("AUTH_URL", "");
    vi.stubEnv("APP_URL", "");
    expect(callbackOrigin(request)).toBeNull();
    vi.stubEnv("APP_URL", "https://jane.example");
    expect(callbackOrigin(request)).toBe("https://jane.example");
  });
});

describe("Robinhood's server", () => {
  let fake: FakeRobinhood;
  beforeEach(async () => {
    fake = await new FakeRobinhood().start();
    vi.stubEnv("ROBINHOOD_MCP_URL", fake.mcpUrl);
    forgetMetadataForTests();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await fake.stop();
  });

  it("reads its addresses, and notes when it has no way to revoke", async () => {
    const metadata = await loadMetadata();
    expect(metadata.tokenEndpoint).toBe(`${fake.origin}/oauth2/token/`);
    expect(metadata.revocationEndpoint).toBeNull();
    expect(await revokeTokens("client", ["token"])).toBe(false);
    expect(fake.revokedTokens).toEqual([]);
  });

  it("refuses metadata that sends tokens to another address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              issuer: "x",
              authorization_endpoint: `${fake.origin}/oauth`,
              token_endpoint: "https://evil.example.com/token",
              registration_endpoint: `${fake.origin}/register`,
            }),
          ),
      ),
    );
    const error = await loadMetadata().catch((e: unknown) => e);
    vi.unstubAllGlobals();
    expect((error as RobinhoodOAuthError).code).toBe("metadata_address");
  });

  it("ignores a revocation address elsewhere", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              issuer: "x",
              authorization_endpoint: `${fake.origin}/oauth`,
              token_endpoint: `${fake.origin}/token`,
              registration_endpoint: `${fake.origin}/register`,
              revocation_endpoint: "https://evil.example.com/revoke",
            }),
          ),
      ),
    );
    const metadata = await loadMetadata();
    vi.unstubAllGlobals();
    expect(metadata.revocationEndpoint).toBeNull();
  });

  it("the fake refuses a wrong PKCE verifier, so these tests would notice one", async () => {
    const page = new URL(`${fake.origin}/oauth`);
    page.search = new URLSearchParams({
      response_type: "code",
      client_id: "client",
      redirect_uri: "http://localhost/back",
      scope: "internal",
      state: "s",
      code_challenge: createHash("sha256").update("right").digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    const html = await (await fetch(page)).text();
    const code = new URL(
      (/id="allow" href="([^"]+)"/.exec(html)?.[1] ?? "").replaceAll("&amp;", "&"),
    ).searchParams.get("code");
    const signInFields = {
      clientId: "client",
      redirectUri: "http://localhost/back",
      verifier: "wrong",
    };
    await expect(exchangeCode(signInFields, code ?? "")).rejects.toThrow(RobinhoodGrantGoneError);
    const tokens = await exchangeCode({ ...signInFields, verifier: "right" }, code ?? "");
    expect(tokens.accessToken).toMatch(/^fake-access/);
    expect(tokens.expiresAt).toBeInstanceOf(Date);
  });

  it("tells a dead refresh token from a server having a bad day", async () => {
    await expect(refreshTokens("client", "not-a-token")).rejects.toThrow(RobinhoodGrantGoneError);
    fake.options.tokenStatus = 500;
    const error = await refreshTokens("client", "any").catch((e: unknown) => e);
    expect((error as RobinhoodOAuthError).code).toBe("token_http_500");
  });

  it("puts none of the server's words, and no token, in an error", async () => {
    fake.options.tokenStatus = 500;
    const error = await refreshTokens("client", "SECRET-REFRESH").catch((e: unknown) => e);
    expect(String(error)).not.toContain("SECRET-REFRESH");
    expect(String(error)).not.toContain("server_error");
  });
});
