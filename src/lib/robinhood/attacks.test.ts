import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { robinhoodAddressAllowed, robinhoodServer } from "@/config/robinhood";
import { ACCOUNT_NUMBER_MARKER } from "./__fixtures__/fake-robinhood";
import { exchangeCode, forgetMetadataForTests, loadMetadata, RobinhoodOAuthError } from "./oauth";
import { parseAccounts } from "./parse";

// A hostile or broken server, and addresses dressed up as Robinhood's (security audit, the link).

const LOCAL = "http://127.0.0.1:4599";
const metadata = {
  issuer: LOCAL,
  authorization_endpoint: `${LOCAL}/oauth`,
  token_endpoint: `${LOCAL}/token`,
  registration_endpoint: `${LOCAL}/register`,
};
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const signIn = { clientId: "c", redirectUri: `${LOCAL}/back`, verifier: "v" };

function answering(token: () => Response, meta: () => Response = () => json(metadata)) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (url.includes("well-known") ? meta() : token())),
  );
}

describe("a server's answers at sign-in", () => {
  beforeEach(() => {
    vi.stubEnv("ROBINHOOD_MCP_URL", `${LOCAL}/mcp/trading`);
    forgetMetadataForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    forgetMetadataForTests();
  });

  it("doesn't read a huge answer into memory", async () => {
    answering(
      () => json({}),
      () => new Response(" ".repeat(3_000_000)),
    );
    await expect(loadMetadata()).rejects.toMatchObject({ code: "too_large" });
    answering(() => new Response(" ".repeat(3_000_000)));
    await expect(exchangeCode(signIn, "code")).rejects.toMatchObject({ code: "too_large" });
  });

  it("keeps no lifetime it couldn't save", async () => {
    for (const expires_in of [1e300, 1e15]) {
      answering(() => json({ access_token: "a", refresh_token: "r", expires_in }));
      const { expiresAt } = await exchangeCode(signIn, "code");
      expect(expiresAt).toBeNull();
    }
    answering(() => json({ access_token: "a", expires_in: 3600 }));
    expect((await exchangeCode(signIn, "code", { now: 0 })).expiresAt).toEqual(new Date(3_600_000));
  });

  it.each(["a\u0000b", "new\nline", "é", "x".repeat(20_000), "", 5])(
    "refuses a token that isn't one: %j",
    async (access_token) => {
      answering(() => json({ access_token }));
      const failure = await exchangeCode(signIn, "code").catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(RobinhoodOAuthError);
      expect((failure as RobinhoodOAuthError).code).toBe("token_answer");
    },
  );

  it("drops a refresh token that isn't one, and keeps the access token", async () => {
    answering(() => json({ access_token: "a", refresh_token: "r\u0000" }));
    expect((await exchangeCode(signIn, "code")).refreshToken).toBeNull();
  });

  it.each(["x".repeat(5_000), "https://evil.example", "a\u0000b", 5])(
    "doesn't key this app's registration on an issuer like %j",
    async (issuer) => {
      answering(
        () => json({}),
        () => json({ ...metadata, issuer }),
      );
      expect((await loadMetadata()).issuer).toBe(robinhoodServer().metadataUrl);
    },
  );
});

describe("what an address must be", () => {
  const official = (address: string) => robinhoodAddressAllowed(address, {});

  it.each([
    "https://agent.robinhood.com/oauth2/token/",
    "https://robinhood.com/oauth",
    "HTTPS://AGENT.ROBINHOOD.COM/x",
  ])("takes Robinhood's own: %s", (address) => {
    expect(official(address)).toBe(true);
  });

  it.each([
    "http://agent.robinhood.com/",
    "https://robinhood.com.evil.example/",
    "https://evilrobinhood.com/",
    "https://evil.example/.robinhood.com",
    "https://agent.robinhood.com@evil.example/",
    "https://evil.example\\@agent.robinhood.com/",
    "https://evil.example#.robinhood.com",
    "https://evil.example?.robinhood.com",
    "javascript:alert(1)//.robinhood.com",
    "file:///etc/passwd",
    "data:text/plain,robinhood.com",
    "https://127.0.0.1/",
    "not an address",
    "",
  ])("refuses %s", (address) => {
    expect(official(address)).toBe(false);
  });

  it.each([
    "https://evil.example/mcp",
    "http://127.0.0.1.evil.example/mcp",
    "http://localhost@evil.example/mcp",
    "http://localhost.evil.example/mcp",
    "http://0.0.0.0/mcp",
    "http://169.254.169.254/mcp",
    "not an address",
  ])("ignores a setting that points at %s", (raw) => {
    const env = { ROBINHOOD_MCP_URL: raw };
    expect(robinhoodServer(env).mcpUrl).toBe("https://agent.robinhood.com/mcp/trading");
    expect(robinhoodAddressAllowed(raw, env)).toBe(false);
  });

  it("on this machine, takes only the fake server's own address", () => {
    const env = { ROBINHOOD_MCP_URL: `${LOCAL}/mcp/trading` };
    expect(robinhoodAddressAllowed(`${LOCAL}/token`, env)).toBe(true);
    expect(robinhoodAddressAllowed("http://127.0.0.1:4600/token", env)).toBe(false);
    expect(robinhoodAddressAllowed("https://agent.robinhood.com/mcp/trading", env)).toBe(false);
  });
});

describe("what kind of account it is", () => {
  const kind = (row: object) =>
    parseAccounts({ accounts: [{ account_number: ACCOUNT_NUMBER_MARKER, ...row }] })[0];

  // Its gains would otherwise leave the taxable figures.
  it.each(["Brother's fund", "My Roth someday", "ira", "my agent"])(
    "isn't decided by a nickname: %s",
    (nickname) => {
      const account = kind({ type: "margin", nickname });
      expect(account).toMatchObject({ subtype: "brokerage", name: "Robinhood" });
    },
  );

  it("has no subtype when only a nickname says", () => {
    expect(kind({ nickname: "Roth" })).toMatchObject({ subtype: null, name: "Robinhood" });
  });

  it.each([
    ["roth_ira", "roth"],
    ["ROTH", "roth"],
    ["traditional_ira", "ira"],
    ["ira", "ira"],
    ["individual", "brokerage"],
  ])("goes by its type: %s", (type, subtype) => {
    expect(kind({ type }).subtype).toBe(subtype);
  });
});
