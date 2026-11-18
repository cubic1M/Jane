import { describe, expect, it, vi } from "vitest";
import { AKOYA } from "@/config/connectors";
import type { ExpectedForm } from "@/planning/tax-documents";
import { whyUnavailable } from "../registry";
import { AkoyaError, akoyaHttp, type AkoyaStatement } from "./api";
import { akoyaTax, sandboxAkoyaTax } from "./connector";
import { formsFromStatements } from "./normalize";
import { matchForms } from "./partner";

// Akoya's Tax API (read connectors, 11-18), with statements shaped by the fields Akoya's reference
// names (docs.akoya.com/reference, search and retrieve tax forms, read 2026-11-17). No network: a
// fake fetch.

const ENV = {
  [AKOYA.clientIdEnv]: "test-client",
  [AKOYA.clientSecretEnv]: "test-secret-value",
};
const LAST = new Date("2027-02-19T18:30:00.000Z");

// A bank's 1099-INT and a broker's 1099-DIV and 1099-B for 2026, a 1098 and a W-2.
const STATEMENTS: AkoyaStatement[] = [
  {
    taxYear: 2026,
    taxStatementId: "st-bank",
    forms: [
      {
        taxYear: 2026,
        accountId: "acct-sav",
        taxFormType: "Tax1099Int",
        tax1099Int: { interestIncome: 412.37, federalTaxWithheld: 0 },
      },
    ],
  },
  {
    taxYear: 2026,
    taxStatementId: "st-broker",
    forms: [
      {
        accountId: "acct-brk",
        taxFormType: "Tax1099Div",
        tax1099Div: { ordinaryDividends: 1250.5, qualifiedDividends: 980.25 },
      },
      {
        accountId: "acct-brk",
        taxFormType: "Tax1099B",
        tax1099B: {
          securityDetails: [
            { longOrShort: "LONG", salesPrice: 5000, costBasis: 3200 },
            {
              longOrShort: "SHORT",
              salesPrice: 1000,
              costBasis: 1300,
              washSaleLossDisallowed: 100,
            },
          ],
        },
      },
    ],
  },
  {
    taxYear: 2026,
    forms: [
      {
        accountId: "acct-mtg",
        taxFormType: "Tax1098",
        tax1098: { mortgageInterest: 8123.45, pointsPaid: null },
      },
      { accountId: "acct-job", taxFormType: "TaxW2" },
      // Another year's form isn't this year's.
      {
        taxYear: 2025,
        accountId: "acct-sav",
        taxFormType: "Tax1099Int",
        tax1099Int: { interestIncome: 1 },
      },
    ],
  },
];

describe("Akoya's tax forms as Jane's boxes", () => {
  const forms = formsFromStatements(STATEMENTS, 2026);

  it("reads a 1099-INT's boxes in cents", () => {
    expect(forms.find((f) => f.formKey === "int")).toEqual({
      formKey: "int",
      accountId: "acct-sav",
      boxes: { interest: 41_237, federalWithheld: 0 },
    });
  });

  it("makes one consolidated brokerage form of a 1099-DIV and a 1099-B", () => {
    expect(forms.find((f) => f.formKey === "brokerage")!.boxes).toEqual({
      dividends: 125_050,
      qualifiedDividends: 98_025,
      proceeds: 600_000,
      costBasis: 450_000,
      // 1,000 - 1,300 + 100 disallowed.
      shortTermGain: -20_000,
      longTermGain: 180_000,
      washDisallowed: 10_000,
    });
  });

  it("leaves an empty box out instead of reading it as zero, and skips W-2s and other years", () => {
    expect(forms.find((f) => f.formKey === "mortgage")!.boxes).toEqual({ interest: 812_345 });
    expect(forms.map((f) => f.formKey).sort()).toEqual(["brokerage", "int", "mortgage"]);
  });

  it("keeps nothing but box amounts", () => {
    const said = JSON.stringify(forms);
    expect(said).not.toMatch(/tin|address|name/i);
  });
});

describe("matching Akoya's forms to the forms Jane expects", () => {
  const expect_ = (key: string, formKey: ExpectedForm["formKey"], from: string): ExpectedForm => ({
    key,
    formKey,
    form: formKey,
    from,
    what: "",
    by: "2027-01-31",
    amountCents: null,
    mayNotSend: false,
  });
  const loaded = {
    statements: STATEMENTS,
    accounts: [
      { accountId: "acct-sav", accountNumberDisplay: "...4321" },
      { accountId: "acct-brk", accountNumberDisplay: "XXXX-8765" },
    ],
  };
  const mine = [
    { name: "Ally Savings", mask: "4321" },
    { name: "Chase Checking", mask: "1111" },
    { name: "Fidelity Brokerage", mask: "8765" },
  ];

  it("finds each form's account by its last four", () => {
    const wanted = [
      expect_("int:chase", "int", "Chase Checking"),
      expect_("int:ally", "int", "Ally Savings"),
      expect_("brokerage:fidelity", "brokerage", "Fidelity Brokerage"),
    ];
    const fetched = matchForms(2026, wanted, loaded, mine);
    expect(fetched.map((f) => f.key).sort()).toEqual(["brokerage:fidelity", "int:ally"]);
    expect(fetched.find((f) => f.key === "int:ally")!.boxes.interest).toBe(41_237);
  });

  it("matches a form without a known account only when it's the one of its kind, both sides", () => {
    // The 1098's account isn't in the list: one expected 1098, one form.
    expect(matchForms(2026, [expect_("mortgage:x", "mortgage", "Rocket")], loaded, mine)).toEqual([
      { key: "mortgage:x", boxes: { interest: 812_345 } },
    ]);
    // Two expected 1098s: which payer it is isn't guessed.
    expect(
      matchForms(
        2026,
        [expect_("mortgage:a", "mortgage", "Rocket"), expect_("mortgage:b", "mortgage", "Chase")],
        loaded,
        mine,
      ),
    ).toEqual([]);
  });
});

describe("Akoya's API, as its reference describes it", () => {
  it("swaps the refresh token for an id_token, the client's keys in the body", async () => {
    const send = vi.fn(async () =>
      Response.json({ token_type: "bearer", id_token: "id-abc", refresh_token: "rt-next" }),
    );
    const tokens = await akoyaHttp({ env: ENV, fetch: send as never }).refresh("rt-first");
    expect(tokens).toEqual({ idToken: "id-abc", refreshToken: "rt-next" });
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sandbox-idp.ddp.akoya.com/token");
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: "refresh_token",
      refresh_token: "rt-first",
      client_id: "test-client",
      client_secret: "test-secret-value",
    });
  });

  it("lists accounts out of their type wrappers, and asks for an account's tax forms", async () => {
    const send = vi.fn(async (url: string) =>
      url.includes("/accounts-info/")
        ? Response.json({
            accounts: [
              { depositAccount: { accountId: "acct-sav", accountNumberDisplay: "...4321" } },
              { investmentAccount: { accountId: "acct-brk" } },
            ],
          })
        : Response.json({ statements: STATEMENTS.slice(0, 1) }),
    );
    const api = akoyaHttp({ env: ENV, fetch: send as never });
    expect((await api.accounts("id-abc", "mikomo", LAST)).map((a) => a.accountId)).toEqual([
      "acct-sav",
      "acct-brk",
    ]);
    const statements = await api.taxStatements("id-abc", "mikomo", "acct-sav", 2026, LAST);
    expect(statements).toHaveLength(1);
    const [url, init] = send.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://sandbox-products.ddp.akoya.com/tax-forms/v3/mikomo?accountId=acct-sav&taxYear=2026",
    );
    expect(init.headers).toMatchObject({
      authorization: "Bearer id-abc",
      "x-akoya-interaction-type": "BATCH",
      "x-akoya-intent-type": "nonpayments",
      "x-akoya-last-access": "2027-02-19T18:30:00Z",
    });
  });

  it("uses production's hosts only when AKOYA_ENV says production", async () => {
    const send = vi.fn(async () => Response.json({ id_token: "id-abc" }));
    await akoyaHttp({
      env: { ...ENV, [AKOYA.envEnv]: "production" },
      fetch: send as never,
    }).refresh("rt");
    expect((send.mock.calls[0] as unknown as [string])[0]).toBe("https://idp.ddp.akoya.com/token");
  });

  it("says a refusal without the token or the keys, and calls nobody without keys or with a bad id", async () => {
    const refused = vi.fn(async () => new Response("nope", { status: 401 }));
    const error = await akoyaHttp({ env: ENV, fetch: refused as never })
      .refresh("rt-secret-token")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AkoyaError);
    expect(String((error as Error).message)).not.toMatch(/rt-secret-token|test-secret-value/);
    const send = vi.fn();
    await expect(akoyaHttp({ env: {}, fetch: send as never }).refresh("rt")).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
    await expect(
      akoyaHttp({ env: ENV, fetch: send as never }).taxStatements("id", "../x", "a", 2026, LAST),
    ).rejects.toMatchObject({ code: "BAD_ID" });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("who Akoya reaches", () => {
  const real = { userId: "user_real", sampleData: false };
  const sample = { userId: "user_sample", sampleData: true };
  const trial = { userId: "trial_abc", sampleData: false };
  const on = { CONNECTORS: "1" };

  it("reaches nobody with CONNECTORS off, is switched off for real people and never for trials", () => {
    expect(whyUnavailable(akoyaTax, real, {})).toBe("off");
    expect(whyUnavailable(akoyaTax, real, on)).toBe("switched_off");
    expect(whyUnavailable(akoyaTax, trial, on)).toBe("trial");
    expect(whyUnavailable(akoyaTax, sample, on)).toBe("real_for_real");
  });

  it("gives sample data the sandbox twin only, and reads without acting", () => {
    expect(whyUnavailable(sandboxAkoyaTax, sample, on)).toBeNull();
    expect(whyUnavailable(sandboxAkoyaTax, real, on)).toBe("sandbox_for_samples");
    for (const c of [akoyaTax, sandboxAkoyaTax]) {
      expect(c.capabilities).toEqual(["read"]);
      expect(c.scopes).toEqual(["read_accounts"]);
      expect(c.act).toBeUndefined();
      expect(c.movesMoney).toBe(false);
    }
  });
});
