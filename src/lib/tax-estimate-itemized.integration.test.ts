import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { correctFact } from "@/lib/profile";
import { loadHomeTaxes } from "./home-taxes";
import {
  ITEMIZED_PAID_SO_FAR_LINE,
  loadTaxEstimate,
  mortgageBalanceUnknownLine,
  mortgageLimitLine,
  SPOUSE_ITEMIZES_UNKNOWN_LINE,
} from "./tax-estimate";

// Tax T6 through the loader: the mortgage balance reaches the estimate's debt limit, the same figure
// is on the Taxes page's home section, a balance read in another year is not applied to that year, and
// a person filing separately is asked about their spouse in a line.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-16T17:00:00Z");

describe.runIf(url)("the itemized deduction through the loader", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: { email: "tax-itemized-t6@example.com", createdAt: NOW },
    });
    userId = user.id;
    const checking = await client.account.create({
      data: {
        userId,
        source: "plaid",
        name: "Plaid checking",
        type: "depository",
        subtype: "checking",
      },
    });
    for (let d = Date.UTC(2026, 0, 2); d <= Date.UTC(2026, 10, 13); d += 14 * 86_400_000) {
      await client.transaction.create({
        data: {
          userId,
          accountId: checking.id,
          source: "plaid",
          date: new Date(d),
          amountCents: -400_000,
          description: "Sweetgreen inc payroll ppd id",
          pfcDetailed: "INCOME_SALARY",
        },
      });
    }
    // A $1,000,000 mortgage with interest reported by the lender, read in 2026.
    const home = await client.account.create({
      data: {
        userId,
        source: "plaid",
        name: "Plaid mortgage",
        type: "loan",
        subtype: "mortgage",
        currentBalanceCents: 100_000_000,
      },
    });
    await client.liability.create({
      data: {
        userId,
        accountId: home.id,
        kind: "mortgage",
        aprBps: 600,
        ytdInterestPaidCents: 4_000_000,
      },
    });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("cuts the interest to the share of the loan under $750,000 and says so", async () => {
    const view = await loadTaxEstimate(userId, { client, now: NOW, year: 2026 });
    expect(view.input.mortgageBalanceCents).toBe(100_000_000);
    const paid = view.input.mortgageInterestCents;
    expect(paid).toBeGreaterThan(0);
    expect(view.estimate.deduction.itemized.mortgageInterestCents).toBe(
      Math.round((paid * 75_000_000) / 100_000_000),
    );
    expect(view.assumptions).toContain(
      mortgageLimitLine(75_000_000, view.estimate.deduction.itemized.mortgageInterestCents, paid),
    );
  });

  it("shows the same figure on the Taxes page's home section", async () => {
    const estimate = await loadTaxEstimate(userId, { client, now: NOW, year: 2026 });
    const home = await loadHomeTaxes(userId, { client, now: NOW, loaded: { estimate } });
    expect(home.homeowner).toBe(true);
    // The home section reads the lender's reported figure; the estimate paces it to the year.
    const reported = 4_000_000;
    expect(home.mortgageInterest!.cents).toBe(Math.round((reported * 75_000_000) / 100_000_000));
  });

  it("does not apply today's balance to an earlier year, and says it counted all of the interest", async () => {
    const view = await loadTaxEstimate(userId, { client, now: NOW, year: 2025 });
    expect(view.input.mortgageBalanceCents).toBeNull();
    expect(view.estimate.deduction.itemized.mortgageInterestCents).toBe(
      view.input.mortgageInterestCents,
    );
    if (view.input.mortgageInterestCents > 0)
      expect(view.assumptions).toContain(mortgageBalanceUnknownLine(2025, 75_000_000));
  });

  it("says that gifts and medical costs are counted as paid so far, only when there are some", async () => {
    const before = await loadTaxEstimate(userId, { client, now: NOW, year: 2026 });
    expect(before.assumptions).not.toContain(ITEMIZED_PAID_SO_FAR_LINE);
    const checking = await client.account.findFirstOrThrow({
      where: { userId, name: "Plaid checking" },
    });
    await client.transaction.create({
      data: {
        userId,
        accountId: checking.id,
        source: "plaid",
        date: new Date(Date.UTC(2026, 9, 3)),
        amountCents: 50_000,
        description: "Red Cross donation",
        pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
      },
    });
    const after = await loadTaxEstimate(userId, { client, now: NOW, year: 2026 });
    expect(after.input.charityCents).toBeGreaterThan(0);
    expect(after.assumptions).toContain(ITEMIZED_PAID_SO_FAR_LINE);
  });

  it("says nothing about a spouse to someone who does not file separately", async () => {
    const view = await loadTaxEstimate(userId, { client, now: NOW, year: 2026 });
    expect(view.input.filingStatus).not.toBe("married_separate");
    expect(view.assumptions).not.toContain(SPOUSE_ITEMIZES_UNKNOWN_LINE);
  });

  it("for a person filing separately: a spouse who itemizes takes the standard deduction away", async () => {
    await correctFact(userId, "filing_status", "married_separate", { client, now: NOW });
    const say = (value: string) =>
      correctFact(userId, "spouse_itemizes", value, { client, now: NOW });
    const view = () => loadTaxEstimate(userId, { client, now: NOW, year: 2026 });

    // Not said: the better of the two, and a line that says the spouse's itemizing was not counted.
    const unknown = await view();
    expect(unknown.input.filingStatus).toBe("married_separate");
    expect(unknown.estimate.deduction.standardCents).toBe(1_610_000);
    expect(unknown.assumptions).toContain(SPOUSE_ITEMIZES_UNKNOWN_LINE);

    await say("yes");
    const yes = await view();
    expect(yes.input.spouseItemizes).toBe(true);
    expect(yes.estimate.deduction.standardCents).toBe(0);
    expect(yes.estimate.deduction.kind).toBe("itemized");
    expect(yes.assumptions).not.toContain(SPOUSE_ITEMIZES_UNKNOWN_LINE);

    await say("no");
    const no = await view();
    expect(no.input.spouseItemizes).toBe(false);
    expect(no.estimate.deduction.standardCents).toBe(1_610_000);
    expect(no.assumptions).not.toContain(SPOUSE_ITEMIZES_UNKNOWN_LINE);

    // "Not sure" is not an answer.
    await say("unsure");
    const unsure = await view();
    expect(unsure.input.spouseItemizes).toBeUndefined();
    expect(unsure.assumptions).toContain(SPOUSE_ITEMIZES_UNKNOWN_LINE);
  });
});
