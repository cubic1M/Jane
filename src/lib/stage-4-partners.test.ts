import { createHmac } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { REAL_ACCOUNT_ADVICE } from "@/config/advice";
import { REAL_TRADING } from "@/config/brokerage";
import { NoCryptoOrders } from "@/lib/brokerage/partner";
import { alpacaOrderBody, alpacaPartner, RealTradingOff } from "@/lib/brokerage/alpaca";
import {
  collectionsOf,
  creditReportOf,
  spinwheelCredit,
  SPINWHEEL_SANDBOX,
} from "@/lib/credit/spinwheel";
import { demoCredit } from "@/lib/credit/demo";
import {
  AmendmentNotSupported,
  COLUMN_SANDBOX,
  columnTaxPartner,
  FilesInPartnerScreen,
  prefillOf,
  statusOf,
  verifyColumnWebhook,
} from "@/lib/filing/column-tax";
import { policiesOf, readCanopyPull, CANOPY_API } from "@/lib/insurance/canopy";
import { BrokerHandles, coverageCatPartner, quotesOf } from "@/lib/insurance/coverage-cat";
import { AdviceOff, realAccountRecommendations } from "@/lib/investments/adviser";
import { NoPermission, withGrant } from "@/lib/permission/gate";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

// Stage 4's partners, against mocks of their APIs built from their docs. None has been run against a
// real API, and none is selected by any code.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const NOW = new Date("2026-11-02T12:00:00Z");

describe("nothing here is on", () => {
  it("the flags that keep it off are off", () => {
    expect(REAL_ACCOUNT_ADVICE).toBe(false);
    expect(REAL_TRADING).toBe(false);
  });

  it("no code selects a partner: only its own file and this test name it", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === "generated" ? [] : walk(path);
        return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
      });
    const files = walk("src").map((p) => ({ p, text: readFileSync(p, "utf8") }));
    for (const [name, home] of [
      ["spinwheelCredit", "src/lib/credit/spinwheel.ts"],
      ["columnTaxPartner", "src/lib/filing/column-tax.ts"],
      ["coverageCatPartner", "src/lib/insurance/coverage-cat.ts"],
      ["readCanopyPull", "src/lib/insurance/canopy.ts"],
      ["alpacaPartner", "src/lib/brokerage/alpaca.ts"],
    ] as const) {
      expect(
        files.filter((f) => f.text.includes(name)).map((f) => f.p),
        name,
      ).toEqual([home]);
    }
  });
});

describe("Spinwheel, credit", () => {
  const profile = {
    data: {
      creditReports: [
        {
          creditScoreDetails: [{ creditScore: 712, model: "VANTAGE_SCORE_3_0" }],
          creditAttributes: [
            { description: "Something else", value: "9" },
            { description: "Average age of open tradelines", value: "53.00" },
          ],
          inquiries: [
            { inquiryDate: "2026-06-01", purposeType: "HARD" },
            { inquiryDate: "2024-06-01", purposeType: "HARD" },
            { inquiryDate: "2026-06-01", purposeType: "SOFT" },
          ],
        },
      ],
      creditCards: [
        { cardProfile: { creditLimit: 5000 } },
        { cardProfile: { creditLimit: 1500.5 } },
      ],
      miscellaneousLiabilities: [
        {
          displayName: "Midland Credit",
          creditor: { originalName: "Old Bank" },
          balanceDetails: { outstandingBalance: 812.5 },
          liabilityProfile: {
            collectionStatus: "IN_COLLECTION",
            accountOriginationDate: "2025-02-03T00:00:00Z",
          },
        },
        { displayName: "A loan", liabilityProfile: { liabilitySubtype: "Other" } },
      ],
    },
  };

  it("reads a report from the fields its reference gives", () => {
    expect(creditReportOf(profile, NOW)).toEqual({
      score: 712,
      model: "VANTAGE_SCORE_3_0",
      range: { low: 300, high: 850 },
      cardLimitCents: 650_050,
      averageAgeMonths: 53,
      hardInquiries: 1,
      demo: false,
    });
  });

  it("refuses a response with no score rather than make one up", () => {
    expect(() => creditReportOf({ data: {} }, NOW)).toThrow("no credit score");
  });

  it("lists only what's in collection", () => {
    expect(collectionsOf(profile, "2026-11-02")).toEqual([
      expect.objectContaining({
        creditor: "Midland Credit",
        originalCreditor: "Old Bank",
        amountCents: 81_250,
        firstSeenOn: "2025-02-03",
      }),
    ]);
  });

  it("pulls by POST, with the key, and keeps Jane's own simulator, which pulls nothing", async () => {
    const fetcher = vi.fn(async () => json(profile)) as unknown as typeof fetch;
    const partner = spinwheelCredit({ apiKey: "k", userId: "u/1", fetcher, now: () => NOW });
    const request = {
      cardBalanceCents: 0,
      overdue: false,
      lateFeesLastYear: 0,
      hasInstallmentLoan: false,
      month: "2026-11",
    };
    expect((await partner.softPull(request)).score).toBe(712);
    const [url, init] = vi.mocked(fetcher).mock.calls[0];
    expect(url).toBe(`${SPINWHEEL_SANDBOX}/v1/users/u%2F1/debtProfile`);
    expect(init).toMatchObject({ method: "POST", headers: { authorization: "Bearer k" } });
    vi.mocked(fetcher).mockClear();
    expect(await partner.estimate(request, {})).toBe(await demoCredit.estimate(request, {}));
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Column Tax", () => {
  const user = {
    id: "u1",
    email: "a@b.test",
    metadata: {
      password_changed_date: null,
      account_locked_date: null,
      passed_mfa_at_this_login: true,
      failed_login_attempts: 0,
      cell_phone_changed_date: null,
      email_changed_date: null,
    },
  };
  const pkg = {
    taxYear: 2026,
    profile: {
      filingStatus: "single",
      childrenUnder17: 0,
      otherDependants: 0,
      state: "CA",
      incomeKinds: [],
    },
    income: {},
    withholding: { federalCents: 0, stateCents: 0 },
    estimatedPayments: { federalCents: 100_001, stateCents: 0 },
    deductions: { studentLoanInterestCents: 0, mortgageInterestCents: 0 },
    tags: {},
    forms: [],
    documents: [],
  };
  const preview = { federalRefundCents: 500, stateRefundCents: null };
  const partner = (fetcher: typeof fetch) =>
    columnTaxPartner({ apiKey: "cred", user, fetcher, statusFor: async () => "accepted" });
  const answer = vi.fn(async () =>
    json({ user_identifier: "u1", user_url: "https://col.test/x" }),
  ) as unknown as typeof fetch;

  it("can't start outside the permission check", async () => {
    await expect(partner(answer).createReturn(pkg, preview)).rejects.toBeInstanceOf(NoPermission);
    expect(answer).not.toHaveBeenCalled();
  });

  it("starts a filing with what its prefill takes, and hands over its screen", async () => {
    const started = await withGrant({ specialist: "filing", userId: "u" }, () =>
      partner(answer).createReturn(pkg, preview),
    );
    expect(started).toEqual({ partnerReturnId: "u1", preview });
    const [url, init] = vi.mocked(answer).mock.calls[0];
    expect(url).toBe(`${COLUMN_SANDBOX}/v1/exp/initialize_tax_filing`);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      user_identifier: "u1",
      user: { email: "a@b.test" },
    });
    expect(
      await withGrant({ specialist: "filing", userId: "u" }, () => partner(answer).filingUrl(pkg)),
    ).toBe("https://col.test/x");
  });

  it("splits estimated payments so they add back up", () => {
    const q = prefillOf(pkg).federal_estimated_quarterly_payments!;
    expect(
      q.estimated_tax_payment_1_amount_cents +
        q.estimated_tax_payment_2_amount_cents +
        q.estimated_tax_payment_3_amount_cents +
        q.estimated_tax_payment_4_amount_cents,
    ).toBe(100_001);
    expect(prefillOf({ ...pkg, estimatedPayments: { federalCents: 0, stateCents: 0 } })).toEqual(
      {},
    );
  });

  it("the person signs in its screen, and it can't amend", async () => {
    const p = partner(answer);
    await expect(p.submitReturn("r", { name: "A B", signedAt: NOW })).rejects.toBeInstanceOf(
      FilesInPartnerScreen,
    );
    await expect(p.createAmendment({ taxYear: 2025, changes: [] })).rejects.toBeInstanceOf(
      AmendmentNotSupported,
    );
  });

  it("reads statuses, and an unknown or retryable one isn't final", async () => {
    expect(statusOf("accepted")).toBe("accepted");
    expect(statusOf("rejected")).toBe("rejected");
    expect(statusOf("retryable")).toBe("submitted");
    expect(statusOf("something_new")).toBe("submitted");
    expect(await partner(answer).status("r", NOW, NOW)).toBe("accepted");
  });

  it("checks a webhook's signature", () => {
    const key = Buffer.from("k").toString("base64");
    const sig = createHmac("sha256", Buffer.from(key, "base64")).update("id.1.{}").digest("base64");
    const head = (signature: string) => ({ id: "id", timestamp: "1", signature });
    expect(verifyColumnWebhook("{}", head(`v1,${sig}`), `whsec_${key}`)).toBe(true);
    expect(verifyColumnWebhook("{ }", head(`v1,${sig}`), `whsec_${key}`)).toBe(false);
    expect(verifyColumnWebhook("{}", head(`v1,${sig}`), "")).toBe(false);
  });
});

describe("Coverage Cat", () => {
  const shopper = { fullName: "A B", email: "a@b.test", address: { state: "CA" } };
  const request = {
    kind: "umbrella" as never,
    state: "CA",
    household: { housing: null, vehicles: null, dependants: null, pets: null },
    deductibleCents: null,
    coverage: {},
    premiumFrequency: "yearly" as never,
    startDate: "2026-12-01",
  };
  const permitted = <T>(act: () => Promise<T>) =>
    withGrant({ specialist: "insurance", userId: "u" }, act);

  it("won't quote outside the check", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(
      coverageCatPartner({ fetcher, shopper }).quote(request, { now: NOW }),
    ).rejects.toBeInstanceOf(NoPermission);
  });

  it("quotes only where it can, and hands the person to its own page", async () => {
    const fetcher = vi.fn(async () =>
      json({
        resume_url: "https://cc.test/resume",
        offers: [
          { carrier: "Acme", annual_price: 240.5, coverage_limit: 1000000, selection_token: "tok" },
          { carrier: "No token" },
        ],
      }),
    ) as unknown as typeof fetch;
    const handoff = vi.fn();
    const partner = coverageCatPartner({ fetcher, shopper, onHandoff: handoff });
    const quotes = await permitted(() => partner.quote(request, { now: NOW }));
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      partnerQuoteId: "tok",
      annualPremiumCents: 24_050,
      demo: false,
    });
    expect(handoff).toHaveBeenCalledWith("https://cc.test/resume");
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0][1]?.body))).toMatchObject({
      sandbox: true,
    });
    vi.mocked(fetcher).mockClear();
    expect(await partner.quote({ ...request, state: "OH" }, { now: NOW })).toEqual([]);
    expect(await partner.quote({ ...request, kind: "auto" as never }, { now: NOW })).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("everything else is the broker's", async () => {
    const partner = coverageCatPartner({ fetcher: vi.fn() as never, shopper });
    await expect(
      partner.cancel(
        { carrier: "x", policyNumber: null },
        { effectiveDate: "2026-12-01", now: NOW },
      ),
    ).rejects.toBeInstanceOf(BrokerHandles);
    await expect(partner.fileClaim({} as never, { now: NOW })).rejects.toBeInstanceOf(
      BrokerHandles,
    );
  });

  it("drops an offer it can't read", () => {
    expect(
      quotesOf(
        [{ carrier: 5 }],
        { kind: "home" as never, coverage: {}, deductibleCents: null },
        NOW,
      ),
    ).toEqual([]);
  });
});

describe("Canopy", () => {
  it("reads a person's policies, with basic auth, read-only", async () => {
    const fetcher = vi.fn(async () =>
      json({
        pull: {
          policies: [
            {
              carrier_friendly_name: "GEICO",
              carrier_policy_number: "P1",
              policy_type: "AUTO",
              total_premium_cents: 120_000,
              effective_date: "2026-01-01T00:00:00Z",
              expiry_date: "2026-07-01T00:00:00Z",
            },
          ],
        },
      }),
    ) as unknown as typeof fetch;
    const out = await readCanopyPull(
      { teamId: "t", pullId: "p" },
      { clientId: "c", clientSecret: "s", fetcher },
    );
    expect(out).toEqual([
      {
        carrier: "GEICO",
        policyNumber: "P1",
        type: "AUTO",
        premiumCents: 120_000,
        effectiveOn: "2026-01-01",
        expiresOn: "2026-07-01",
      },
    ]);
    const [url, init] = vi.mocked(fetcher).mock.calls[0];
    expect(url).toBe(`${CANOPY_API}/teams/t/pulls/p`);
    expect(init?.headers).toEqual({
      authorization: `Basic ${Buffer.from("c:s").toString("base64")}`,
    });
    expect(init?.method).toBeUndefined();
  });

  it("doesn't invent what isn't there", () => {
    expect(policiesOf({ policies: [{}] })[0]).toEqual({
      carrier: "Your insurer",
      policyNumber: null,
      type: "other",
      premiumCents: null,
      effectiveOn: null,
      expiresOn: null,
    });
  });
});

describe("investing", () => {
  const order = {
    accountId: "a",
    ticker: "VTI",
    securityName: "VTI",
    side: "buy" as const,
    amountCents: 12_345,
  };

  it("Alpaca can't place an order, and refuses crypto first", async () => {
    const options = { client: {} as never, now: NOW };
    await expect(
      alpacaPartner().placeOrders("u", { batchId: "b", reason: "r", orders: [order] }, options),
    ).rejects.toBeInstanceOf(RealTradingOff);
    await expect(
      alpacaPartner().placeOrders(
        "u",
        { batchId: "b", reason: "r", orders: [{ ...order, ticker: "BTC" }] },
        options,
      ),
    ).rejects.toBeInstanceOf(NoCryptoOrders);
    expect(alpacaPartner().simulated).toBe(false);
  });

  it("what an order would be, by its docs", () => {
    expect(alpacaOrderBody(order)).toEqual({
      symbol: "VTI",
      notional: "123.45",
      side: "buy",
      type: "market",
      time_in_force: "day",
    });
    expect(() => alpacaOrderBody({ ...order, ticker: "ETH" })).toThrow(NoCryptoOrders);
    expect(() => alpacaOrderBody({ ...order, side: "deposit" })).toThrow();
  });

  it("nothing overrides REAL_ACCOUNT_ADVICE: no recommendation, whatever partner is given", async () => {
    const recommend = vi.fn(async () => []);
    const adviser = { name: "A registered adviser", recommend };
    await expect(realAccountRecommendations(adviser, { accountIds: ["a"] })).rejects.toBeInstanceOf(
      AdviceOff,
    );
    await expect(
      withGrant({ specialist: "brokerage", userId: "u" }, () =>
        realAccountRecommendations(adviser, { accountIds: ["a"] }),
      ),
    ).rejects.toBeInstanceOf(AdviceOff);
    expect(recommend).not.toHaveBeenCalled();
  });
});
