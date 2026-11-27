import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SNAPTRADE } from "@/config/connectors";
import { canonicalJson } from "../canonical-json";
import { whyUnavailable } from "../registry";
import { signatureValid } from "../webhooks";
import { SnaptradeError, requestSignature, snaptradeHttp } from "./api";
import { parseSnaptradeEvent, sandboxSnaptradeHoldings, snaptradeHoldings } from "./connector";
import { readable, snaptradeRead } from "./normalize";
import { SNAPTRADE_DOCS_ACCOUNT, SNAPTRADE_DOCS_POSITIONS, sampleAccount } from "./sample";

// SnapTrade (read connectors, batch 2), against SnapTrade's own documented examples (docs.snaptrade.com,
// read 2026-11-19). No network: a fake fetch.

afterEach(() => vi.unstubAllEnvs());

const ENV = { [SNAPTRADE.clientIdEnv]: "TESTCLIENT", [SNAPTRADE.consumerKeyEnv]: "test-consumer" };
const USER = { userId: "0b8f8c2e-5c1a-4b7e-9a51-2f3d4c5b6a71", userSecret: "test-user-secret" };
const NOW = new Date("2026-11-19T15:00:00Z");

describe("SnapTrade's holdings as Plaid Investments' shape", () => {
  const read = snaptradeRead(SNAPTRADE_DOCS_ACCOUNT, SNAPTRADE_DOCS_POSITIONS);

  it("reads the account: its name, last four, kind and total in cents", () => {
    expect(read.externalId).toBe("917c8734-8470-4a3e-a18f-57c3f2ee6631");
    expect(read.account).toEqual({
      name: "Robinhood Individual",
      mask: "8443",
      type: "investment",
      subtype: "brokerage",
      currentBalanceCents: 8_421_355,
    });
    expect(read.asOf).toBe("2026-06-02");
  });

  it("reads a stock and a fund with Plaid's types, value and total cost basis", () => {
    expect(read.holdings).toEqual([
      expect.objectContaining({
        ref: "snaptrade:AAPL",
        name: "Apple Inc.",
        ticker: "AAPL",
        type: "equity",
        subtype: "common stock",
        quantity: 10.5,
        priceCents: 12_345,
        // 10.5 × 123.45
        valueCents: 129_623,
        // 10.5 × 118.2: SnapTrade's is per share, Jane's is the position's.
        costBasisCents: 124_110,
      }),
      expect.objectContaining({
        ref: "snaptrade:VFIAX",
        type: "mutual fund",
        subtype: "mutual fund",
        isCashEquivalent: false,
      }),
    ]);
  });

  it("leaves out an option, another currency and an unreadable figure, and counts them", () => {
    expect(read.leftOut).toBe(1);
    const odd = snaptradeRead(SNAPTRADE_DOCS_ACCOUNT, {
      results: [
        { ...SNAPTRADE_DOCS_POSITIONS.results[0]!, currency: "CAD" },
        { ...SNAPTRADE_DOCS_POSITIONS.results[0]!, units: "1e3" },
      ],
    });
    expect(odd.holdings).toEqual([]);
    expect(odd.leftOut).toBe(2);
  });

  it("adds two lines under one ticker into one holding", () => {
    const first = SNAPTRADE_DOCS_POSITIONS.results[0]!;
    const both = snaptradeRead(SNAPTRADE_DOCS_ACCOUNT, { results: [first, first] });
    const one = snaptradeRead(SNAPTRADE_DOCS_ACCOUNT, { results: [first] }).holdings[0]!;
    expect(both.holdings).toHaveLength(1);
    expect(both.holdings[0]).toMatchObject({
      quantity: one.quantity * 2,
      valueCents: one.valueCents * 2,
    });
  });

  it("reads retirement accounts by the brokerage's words, and skips paper, closed and non-investment ones", () => {
    const kind = (raw_type: string) =>
      snaptradeRead({ ...SNAPTRADE_DOCS_ACCOUNT, raw_type }, { results: [] }).account.subtype;
    expect([kind("Roth IRA"), kind("Traditional IRA"), kind("401k"), kind("Cash")]).toEqual([
      "roth",
      "ira",
      "401k",
      "brokerage",
    ]);
    expect(readable(SNAPTRADE_DOCS_ACCOUNT)).toBe(true);
    expect(readable({ ...SNAPTRADE_DOCS_ACCOUNT, is_paper: true })).toBe(false);
    expect(readable({ ...SNAPTRADE_DOCS_ACCOUNT, status: "closed" })).toBe(false);
    expect(readable({ ...SNAPTRADE_DOCS_ACCOUNT, kind: "deposit" })).toBe(false);
  });

  it("gives the sample account the total its positions add up to", () => {
    expect(sampleAccount().net_value).toEqual({ amount: 2592.46, currency: "USD" });
  });
});

describe("SnapTrade's API, as its reference describes it", () => {
  it("signs the canonical JSON of content, path and query, as the Request Signatures page shows", () => {
    // The page's own example request and the canonical string it says to sign.
    const query = "clientId=YOUR_CLIENT_ID&timestamp=1715123456";
    expect(canonicalJson({ content: { substring: "AAPL" }, path: "/symbols", query })).toBe(
      '{"content":{"substring":"AAPL"},"path":"/symbols","query":"clientId=YOUR_CLIENT_ID&timestamp=1715123456"}',
    );
    expect(requestSignature("YOUR_CONSUMER_KEY", "/symbols", query, { substring: "AAPL" })).toBe(
      createHmac("sha256", "YOUR_CONSUMER_KEY")
        .update(
          '{"content":{"substring":"AAPL"},"path":"/symbols","query":"clientId=YOUR_CLIENT_ID&timestamp=1715123456"}',
        )
        .digest("base64"),
    );
    // No body, or an empty one, signs as null.
    expect(requestSignature("k", "/accounts/all", "q=1", undefined)).toBe(
      requestSignature("k", "/accounts/all", "q=1", {}),
    );
  });

  it("writes canonical JSON as Python's json.dumps(sort_keys=True) does", () => {
    // python3 -c 'json.dumps({"b":"é\x7f","a":[1,{"z":None,"y":True}]},separators=(",",":"),sort_keys=True)'
    expect(canonicalJson({ b: "é\u007f", a: [1, { z: null, y: true }] })).toBe(
      '{"a":[1,{"y":true,"z":null}],"b":"\\u00e9\\u007f"}',
    );
  });

  it("asks the portal for a read connection, signed, with the person's SnapTrade user", async () => {
    const send = vi.fn(async () =>
      Response.json({ redirectURI: "https://app.snaptrade.com/snapTrade/redeemToken?token=x" }),
    );
    const url = await snaptradeHttp({ env: ENV, fetch: send as never, now: () => NOW }).connectLink(
      USER,
    );
    expect(url).toMatch(/^https:\/\/app\.snaptrade\.com\//);
    const [to, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(to);
    expect(parsed.origin + parsed.pathname).toBe("https://api.snaptrade.com/snapTrade/login");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      clientId: "TESTCLIENT",
      timestamp: String(NOW.getTime() / 1000),
      userId: USER.userId,
      userSecret: USER.userSecret,
    });
    expect(JSON.parse(String(init.body))).toEqual({ connectionType: "read" });
    const headers = init.headers as Record<string, string>;
    expect(headers.Signature).toBe(
      requestSignature("test-consumer", "/snapTrade/login", parsed.search.slice(1), {
        connectionType: "read",
      }),
    );
  });

  it("lists accounts, then each account's positions", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ results: [SNAPTRADE_DOCS_ACCOUNT] }))
      .mockResolvedValueOnce(Response.json(SNAPTRADE_DOCS_POSITIONS));
    const api = snaptradeHttp({ env: ENV, fetch: send as never, now: () => NOW });
    expect(await api.accounts(USER)).toHaveLength(1);
    expect((await api.positions(USER, SNAPTRADE_DOCS_ACCOUNT.id)).results).toHaveLength(3);
    const paths = send.mock.calls.map(([u]) => new URL(String(u)).pathname);
    expect(paths).toEqual([
      "/accounts/all",
      "/accounts/917c8734-8470-4a3e-a18f-57c3f2ee6631/positions/all",
    ]);
  });

  it("calls nobody without keys or with a bad id, and never says a secret in an error", async () => {
    const none = vi.fn();
    await expect(
      snaptradeHttp({ env: {}, fetch: none as never }).accounts(USER),
    ).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(
      snaptradeHttp({ env: ENV, fetch: none as never }).positions(USER, "../x"),
    ).rejects.toMatchObject({ code: "BAD_ID" });
    expect(none).not.toHaveBeenCalled();
    const refused = vi.fn(async () => Response.json({ detail: "no" }, { status: 401 }));
    const error = await snaptradeHttp({ env: ENV, fetch: refused as never })
      .accounts(USER)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SnaptradeError);
    expect(String((error as Error).message)).not.toMatch(/test-(consumer|user-secret)/);
  });
});

describe("SnapTrade's webhooks", () => {
  const body = JSON.stringify({
    userId: USER.userId,
    clientId: "PARTNERAPP",
    accountId: "45a3g56a-eef6-4904-a68e-d3f90c3e07c5",
    eventType: "ACCOUNT_HOLDINGS_UPDATED",
    webhookId: "312a13f3-3929-46dd-a70f-ade6aaefc100",
    eventTimestamp: "2026-11-19T14:58:13.111991+00:00",
  });
  const signing = snaptradeHoldings.webhook!.signing;
  const sign = (key: string, text = body) =>
    createHmac("sha256", key)
      .update(canonicalJson(JSON.parse(text)))
      .digest("base64");
  const headers = (sig: string) => new Headers({ Signature: sig });

  it("checks Signature over the body's canonical JSON with the consumer key, and its age", () => {
    vi.stubEnv(SNAPTRADE.consumerKeyEnv, "test-consumer");
    expect(signatureValid(signing, body, headers(sign("test-consumer")), { now: NOW })).toBe(true);
    expect(signatureValid(signing, body, headers(sign("another")), { now: NOW })).toBe(false);
    const later = new Date(NOW.getTime() + 10 * 60_000);
    expect(signatureValid(signing, body, headers(sign("test-consumer")), { now: later })).toBe(
      false,
    );
    const edited = body.replace("ACCOUNT_HOLDINGS_UPDATED", "CONNECTION_BROKEN");
    expect(signatureValid(signing, edited, headers(sign("test-consumer")), { now: NOW })).toBe(
      false,
    );
  });

  it("reads fresh holdings and a broken or fixed connection for that SnapTrade user", () => {
    expect(parseSnaptradeEvent(JSON.parse(body))).toEqual({
      kind: "link",
      eventId: "312a13f3-3929-46dd-a70f-ade6aaefc100",
      linkRef: USER.userId,
      change: "refreshed",
    });
    expect(
      parseSnaptradeEvent({ userId: USER.userId, eventType: "CONNECTION_BROKEN" })?.change,
    ).toBe("disconnected");
    expect(
      parseSnaptradeEvent({ userId: USER.userId, eventType: "CONNECTION_FIXED" })?.change,
    ).toBe("reconnected");
    expect(parseSnaptradeEvent({ userId: USER.userId, eventType: "TRADE_DETECTION" })).toBeNull();
  });
});

describe("who SnapTrade reaches", () => {
  const real = { userId: "user_real", sampleData: false };
  const sample = { userId: "user_sample", sampleData: true };
  const trial = { userId: "trial_abc", sampleData: false };
  const on = { CONNECTORS: "1" };

  it("is off for real people and trials, and the twin is for sample data only", () => {
    expect(whyUnavailable(snaptradeHoldings, real, {})).toBe("off");
    expect(whyUnavailable(snaptradeHoldings, real, on)).toBe("switched_off");
    expect(whyUnavailable(snaptradeHoldings, trial, on)).toBe("trial");
    expect(whyUnavailable(sandboxSnaptradeHoldings, sample, on)).toBeNull();
    expect(whyUnavailable(sandboxSnaptradeHoldings, real, on)).toBe("sandbox_for_samples");
  });

  it("only reads: no trading, no money, nothing it recommends", () => {
    for (const c of [snaptradeHoldings, sandboxSnaptradeHoldings]) {
      expect(c.capabilities).toEqual(["read"]);
      expect(c.act).toBeUndefined();
      expect(c.movesMoney).toBe(false);
      expect(c.recommends).toBeUndefined();
      expect(c.scopes).not.toContain("place_orders");
    }
    expect(SNAPTRADE.connectionType).toBe("read");
  });
});
