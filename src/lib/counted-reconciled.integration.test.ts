import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { accountsNotCounted } from "@/lib/account-copies";
import { debtFirst } from "@/lib/debt-first";
import { encrypt } from "@/lib/crypto";
import { scopedFor } from "@/lib/db-scoped";
import { loadHomeTaxes } from "@/lib/home-taxes";
import { loadRetirementAccounts } from "@/lib/investments/retirement-accounts";
import { answerDebt } from "@/lib/jane-agent/debt-answer";
import { loadProfileInput } from "@/lib/profile";
import { loadTaxForms } from "@/lib/tax-organizer";
import { loadTaxSetAside } from "@/lib/tax-set-aside";

// CodeRabbit's ten comments on #2259 had one cause: leaving a copy out threw away what only the copy
// carried. Each reader below is built from the example in its comment: an account linked twice, the
// account that counts without the fact, the copy with it.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-24T18:00:00Z");

describe.runIf(url)("a copy's facts reach the account that counts", { timeout: 180_000 }, () => {
  let client: PrismaClient;
  const users: string[] = [];

  const person = async () => {
    const user = await client.user.create({
      data: { email: `reconciled-${crypto.randomUUID()}@example.com`, timezone: "UTC" },
    });
    users.push(user.id);
    return user.id;
  };
  // The same account linked at two banks: which one counts is the rule's call, so the fact goes on
  // the one that doesn't.
  async function linkedTwice(userId: string, data: object) {
    const mk = async (n: number) => {
      const item = await client.plaidItem.create({
        data: {
          userId,
          plaidItemId: `item-${crypto.randomUUID()}`,
          accessTokenEncrypted: encrypt(`access-${n}`),
          institutionName: "Chase",
          lastSyncedAt: NOW,
        },
      });
      return client.account.create({
        data: {
          userId,
          source: "plaid",
          itemId: item.id,
          plaidAccountId: `pa-${crypto.randomUUID()}`,
          mask: "7777",
          name: "Account",
          ...data,
        } as never,
      });
    };
    const [a, b] = [await mk(1), await mk(2)];
    const left = await accountsNotCounted(scopedFor(userId, client));
    const copy = left.has(a.id) ? a : b;
    const kept = copy.id === a.id ? b : a;
    expect([...left.keys()]).toEqual([copy.id]);
    return { kept, copy };
  }
  const liability = (userId: string, accountId: string, data: object) =>
    client.liability.create({ data: { userId, accountId, ...data } as never });

  beforeAll(() => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("debt-first: the rate the copy reports still raises the warning", async () => {
    const userId = await person();
    const { kept, copy } = await linkedTwice(userId, {
      type: "credit",
      subtype: "credit card",
      currentBalanceCents: 500_000,
    });
    await liability(userId, kept.id, { kind: "credit", aprBps: null });
    await liability(userId, copy.id, { kind: "credit", aprBps: 2400 });
    expect(await debtFirst(userId, client)).toBe("You're carrying debt at up to 24% a year.");
  });

  it("the chat's interest reply: the mortgage interest the copy reports is said", async () => {
    const userId = await person();
    const { kept, copy } = await linkedTwice(userId, {
      type: "loan",
      subtype: "mortgage",
      name: "Home loan",
      currentBalanceCents: 30_000_000,
    });
    await liability(userId, kept.id, { kind: "mortgage", ytdInterestPaidCents: null });
    await liability(userId, copy.id, { kind: "mortgage", ytdInterestPaidCents: 654_300 });
    const reply = await answerDebt(userId, { kind: "card_interest", thisYear: true } as never, {
      client,
      now: NOW,
    });
    expect(reply.body).toContain("$6,543.00 on Home loan");
  });

  it("the profile: the liability that counts carries the interest the copy reports", async () => {
    const userId = await person();
    const { kept, copy } = await linkedTwice(userId, {
      type: "loan",
      subtype: "student",
      name: "Student loan",
      currentBalanceCents: 2_000_000,
    });
    await liability(userId, kept.id, { kind: "student", ytdInterestPaidCents: null });
    await liability(userId, copy.id, { kind: "student", ytdInterestPaidCents: 88_000 });
    const input = await loadProfileInput(userId, { client, now: NOW });
    const rows = input.liabilities.filter((l) => l.accountId === kept.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].ytdInterestPaidCents).toBe(88_000);
    expect(input.liabilities.some((l) => l.accountId === copy.id)).toBe(false);
  });

  it("home taxes: the mortgage interest the copy reports is the figure", async () => {
    const userId = await person();
    const { kept, copy } = await linkedTwice(userId, {
      type: "loan",
      subtype: "mortgage",
      name: "Home loan",
      currentBalanceCents: 30_000_000,
    });
    await liability(userId, kept.id, { kind: "mortgage", ytdInterestPaidCents: null });
    await liability(userId, copy.id, { kind: "mortgage", ytdInterestPaidCents: 987_000 });
    const view = await loadHomeTaxes(userId, { client, now: NOW });
    expect(view.mortgageInterest?.cents).toBe(987_000);
  });

  it("tax forms: only the account that counts is expected to send a brokerage form", async () => {
    const userId = await person();
    await linkedTwice(userId, {
      type: "investment",
      subtype: "brokerage",
      name: "Brokerage",
      currentBalanceCents: 1_000_000,
    });
    const view = await loadTaxForms(userId, 2026, { client, now: NOW });
    expect(view.forms.filter((f) => f.formKey === "brokerage")).toHaveLength(1);
  });

  it("the IRA: contributions made before the link began count toward the year, once", async () => {
    const userId = await person();
    const { kept, copy } = await linkedTwice(userId, {
      type: "investment",
      subtype: "ira",
      name: "Rollover IRA",
      currentBalanceCents: 1_000_000,
    });
    const tx = (accountId: string, date: string, amountCents: number, n: number) =>
      client.investmentTransaction.create({
        data: {
          userId,
          accountId,
          date: new Date(`${date}T00:00:00Z`),
          name: `Contribution ${n}`,
          amountCents,
          quantity: 0,
          priceCents: 0,
          type: "cash",
          subtype: "contribution",
          plaidInvestmentTransactionId: `it-${crypto.randomUUID()}`,
        } as never,
      });
    // $3,000 put in before the link began (only on the copy), and $500 on a day both have.
    await tx(copy.id, "2026-01-10", -300_000, 1);
    await tx(copy.id, "2026-03-01", -50_000, 2);
    await tx(kept.id, "2026-03-01", -50_000, 3);
    const view = await loadRetirementAccounts(userId, { client, now: NOW });
    expect(view.limits.find((l) => l.key === "ira")?.usedCents).toBe(350_000);
  });

  it("the tax set-aside: a goal on the copy keeps its balance, in the account that counts", async () => {
    const userId = await person();
    const { copy } = await linkedTwice(userId, {
      type: "depository",
      subtype: "savings",
      name: "Savings",
      currentBalanceCents: 400_000,
    });
    // A freelancer with ten months of income and tax to cover (as tax-set-aside.integration.test.ts).
    const checking = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 6_000_000,
      },
    });
    await client.taxProfile.create({
      data: {
        userId,
        filingStatus: "single",
        state: "TX",
        childrenUnder17: 0,
        otherDependants: 0,
        answered: ["filingStatus", "state", "dependants"],
      },
    });
    await client.transaction.createMany({
      data: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"].map((m) => ({
        userId,
        accountId: checking.id,
        source: "csv" as const,
        dedupeKey: crypto.randomUUID(),
        date: new Date(`2026-${m}-15T00:00:00Z`),
        amountCents: -500_000,
        description: "BRIGHTLEAF MEDIA",
        merchantName: "BRIGHTLEAF MEDIA",
        pfcPrimary: "INCOME",
        pfcDetailed: "INCOME_CONTRACTOR",
        categorySource: "rule" as const,
      })),
    });
    await client.savingsGoal.create({
      data: {
        userId,
        name: "Taxes",
        accountId: copy.id,
        targetCents: 1_000_000,
        targetDate: new Date("2027-12-31T00:00:00Z"),
      },
    });
    const view = await loadTaxSetAside(userId, { client, now: NOW });
    expect(view.keptApartCents).toBe(400_000);
  });
});
