import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { METHOD } from "@/config/connectors";
import { consentWords } from "../consent";
import { whyUnavailable } from "../registry";
import { signatureValid } from "../webhooks";
import { MethodError, methodHttp } from "./api";
import { methodLiabilities, parseMethodEvent, sandboxMethodLiabilities } from "./connector";
import { methodReads } from "./normalize";
import { METHOD_DOCS_ACCOUNTS, sampleAccounts } from "./sample";

// Method (read connectors, batch 2), against Method's own documented examples (docs.methodfi.com,
// API reference 2026-03-30, read 2026-11-19). No network: a fake fetch.

afterEach(() => vi.unstubAllEnvs());

const ENTITY = "ent_y1a9e1fbnJ1f3";
const ENV = { [METHOD.apiKeyEnv]: "test-method-key" };

describe("Method's liabilities as Jane's accounts and loans", () => {
  const [card, car, student] = methodReads(METHOD_DOCS_ACCOUNTS);

  it("reads a card: its balance and minimum in cents, and no single rate from a range", () => {
    expect(card!.account).toEqual({
      name: "Chase Sapphire Reserve Credit Card",
      mask: "1580",
      type: "credit",
      subtype: "credit card",
      currentBalanceCents: 80_000,
    });
    expect(card!.liability).toMatchObject({
      kind: "credit",
      // 12% to 23.5% is a range, not one rate.
      aprBps: null,
      minimumPaymentCents: 4_000,
      nextPaymentDueDate: "2024-05-01",
    });
    expect(card!.source).toBe("direct");
  });

  it("reads a car loan's rate, term, start and payoff", () => {
    expect(car!.account).toMatchObject({
      type: "loan",
      subtype: "auto",
      currentBalanceCents: 1_500_000,
    });
    expect(car!.liability).toMatchObject({
      kind: "loan",
      aprBps: 350,
      rateType: "fixed",
      minimumPaymentCents: 35_000,
      originationPrincipalCents: 2_000_000,
      originationDate: "2019-04-15",
      payoffDate: "2029-04-15",
      loanTermMonths: 120,
    });
  });

  it("reads a federal student loan from the credit report, never calling it a Direct Loan", () => {
    expect(student!.account).toMatchObject({ type: "loan", subtype: "student" });
    expect(student!.liability).toMatchObject({
      kind: "student",
      aprBps: 429,
      description: "Federal student loans",
    });
    expect(student!.source).toBe("snapshot");
    expect(student!.liability.description).not.toMatch(/direct/i);
  });

  it("leaves out kinds Jane has no page for, and anything that isn't a liability", () => {
    const other = [
      { id: "acc_a", type: "liability", liability: { type: "collection" } },
      { id: "acc_b", type: "ach" },
    ];
    expect(methodReads(other as never)).toEqual([]);
  });

  it("moves the sample's dates so the card is due 12 days after the person's day", () => {
    const [sampleCard] = methodReads(sampleAccounts("2026-11-19"));
    expect(sampleCard!.liability.nextPaymentDueDate).toBe("2026-12-01");
    expect(sampleCard!.liability.originationDate).toBe("2018-10-30");
  });
});

describe("Method's API, as its reference describes it", () => {
  it("lists the person's active liabilities with each one's newest update, page by page", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({
      ...METHOD_DOCS_ACCOUNTS[0]!,
      id: `acc_${i}`,
    }));
    const send = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: full }))
      .mockResolvedValueOnce(Response.json({ data: [METHOD_DOCS_ACCOUNTS[1]] }));
    const accounts = await methodHttp({ env: ENV, fetch: send as never }).liabilities(ENTITY);
    expect(accounts).toHaveLength(101);
    const [url, init] = send.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://dev.methodfi.com/accounts");
    expect(Object.fromEntries(parsed.searchParams)).toMatchObject({
      holder_id: ENTITY,
      type: "liability",
      status: "active",
      "expand[]": "update",
      page: "1",
      page_limit: "100",
    });
    expect(init.headers).toMatchObject({
      authorization: "Bearer test-method-key",
      "method-version": "2026-03-30",
    });
    expect(new URL((send.mock.calls[1] as [string])[0]).searchParams.get("page")).toBe("2");
  });

  it("never reaches Method's live-data Sandbox: Development unless METHOD_ENV says production", async () => {
    const send = vi.fn(async () => Response.json({ data: [] }));
    await methodHttp({
      env: { ...ENV, [METHOD.envEnv]: "sandbox" },
      fetch: send as never,
    }).liabilities(ENTITY);
    expect(String((send.mock.calls[0] as unknown as [string])[0])).toMatch(
      /^https:\/\/dev\.methodfi\.com\//,
    );
  });

  it("says a refusal without the key, and calls nobody without a key or with a bad id", async () => {
    const refused = vi.fn(async () => Response.json({ error: "no" }, { status: 401 }));
    const error = await methodHttp({ env: ENV, fetch: refused as never })
      .liabilities(ENTITY)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MethodError);
    expect(String((error as Error).message)).not.toContain("test-method-key");
    const none = vi.fn();
    await expect(
      methodHttp({ env: {}, fetch: none as never }).liabilities(ENTITY),
    ).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
    await expect(
      methodHttp({ env: ENV, fetch: none as never }).liabilities("../x"),
    ).rejects.toMatchObject({
      code: "BAD_ID",
    });
    expect(none).not.toHaveBeenCalled();
  });
});

describe("Method's webhooks", () => {
  const now = new Date("2026-11-19T15:00:00Z");
  const t = String(Math.floor(now.getTime() / 1000));
  const body = JSON.stringify({
    id: "cxn_4ewMmBbjYDMR4",
    type: "connect.available",
    op: "update",
    path: `/entities/${ENTITY}/connect/cxn_4ewMmBbjYDMR4`,
  });
  const signing = methodLiabilities.webhook!.signing;

  it("checks method-webhook-signature over '<timestamp>:<body>'", () => {
    vi.stubEnv(METHOD.webhookSecretEnv, "method-test");
    const sign = (secret: string, sep: string) =>
      createHmac("sha256", secret).update(`${t}${sep}${body}`).digest("hex");
    const headers = (sig: string) =>
      new Headers({ [METHOD.signatureHeader]: sig, [METHOD.timestampHeader]: t });
    expect(signatureValid(signing, body, headers(sign("method-test", ":")), { now })).toBe(true);
    expect(signatureValid(signing, body, headers(sign("method-test", ".")), { now })).toBe(false);
    expect(signatureValid(signing, body, headers(sign("another", ":")), { now })).toBe(false);
  });

  it("reads a finished Connect as fresh data for that person's entity", () => {
    expect(parseMethodEvent(JSON.parse(body))).toEqual({
      kind: "link",
      eventId: "connect.available:cxn_4ewMmBbjYDMR4",
      linkRef: ENTITY,
      change: "refreshed",
    });
    expect(parseMethodEvent({ type: "payment.update", path: "/payments/pmt_x" })).toBeNull();
  });
});

describe("who Method reaches", () => {
  const real = { userId: "user_real", sampleData: false };
  const sample = { userId: "user_sample", sampleData: true };
  const trial = { userId: "trial_abc", sampleData: false };
  const on = { CONNECTORS: "1" };

  it("is off for real people and trials, and the twin is for sample data only", () => {
    expect(whyUnavailable(methodLiabilities, real, {})).toBe("off");
    // The soft-pull lock answers before REAL_CONNECTORS (soft-pull-lock.test.ts).
    expect(whyUnavailable(methodLiabilities, real, on)).toBe("needs_counsel");
    expect(whyUnavailable(methodLiabilities, trial, on)).toBe("trial");
    expect(whyUnavailable(sandboxMethodLiabilities, sample, on)).toBeNull();
    expect(whyUnavailable(sandboxMethodLiabilities, real, on)).toBe("sandbox_for_samples");
  });

  it("can't be consented to for real until the soft pull's own words are approved", () => {
    expect(methodLiabilities.scopes).toContain("soft_credit_pull");
    expect(methodLiabilities.consentText).toBeUndefined();
    expect(consentWords(methodLiabilities, methodLiabilities.scopes)).toBeNull();
  });

  it("only reads, and moves no money", () => {
    for (const c of [methodLiabilities, sandboxMethodLiabilities]) {
      expect(c.capabilities).toEqual(["read"]);
      expect(c.act).toBeUndefined();
      expect(c.movesMoney).toBe(false);
    }
  });
});
