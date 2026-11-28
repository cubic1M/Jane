import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadTaxEstimate } from "./tax-estimate";

// T7: no next-January pay or wrong-year payment in a year's estimate. A 2026 estimate opened in 2027
// held January 2027's paychecks (the transaction query reaches into February for January's tax
// payments, and the paychecks were never cut at the year), and a payment on January 10, 2027 or one
// late in April could land in the wrong year or be taken for the wrong thing.
//
// Hand examples (worked on paper, then checked against this file's probe):
// - Pay: $688.40 every other Friday from 2025-11-14 is 26 paydays in 2026 (Jan 9 to Dec 25); Jan 8
//   and Jan 22, 2027 are next year's. 2026 wages (year over, pay taken as it came) = 26 x $688.40 =
//   $17,898.40; 2027 on Feb 10 has Jan 8, Jan 22 and Feb 5 = 3 paychecks.
// - Payments: $1,500.00 to the IRS on 2027-01-10 is 2026's fourth installment: 2026 sees $1,500.00
//   paid, 2027 sees $0 (its window starts Feb 1).
// - April: $2,000.00 on 2026-04-14. With a confirmed 2025 return that owed $2,000.00 and no estimates
//   paid in 2025: counted, with the line "it may be last year's balance". With estimates paid in
//   2025, or a different balance, or no return: counted, no line.

const url = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;
const at = (d: string) => new Date(`${d}T00:00:00Z`);
const PAY = -68_840;

describe.runIf(url)("a year's estimate keeps to the year", { timeout: 180_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];

  async function person(
    email: string,
    {
      first,
      pay,
      payer = "UC DAVIS PAYROLL PPD ID: 9460001234",
      cents = PAY,
      payments = [],
      timezone,
    }: {
      first: string;
      pay: string[];
      payer?: string;
      cents?: number;
      payments?: { date: string; cents: number }[];
      timezone?: string;
    },
  ) {
    await client.user.deleteMany({ where: { email } });
    const userId = (
      await client.user.create({
        data: { email, createdAt: at(first), timezone: timezone ?? null },
      })
    ).id;
    made.push(userId);
    const checking = await client.account.create({
      data: {
        userId,
        source: "plaid",
        name: "Plaid checking",
        type: "depository",
        subtype: "checking",
      },
    });
    const line = (date: string, amountCents: number, description: string, pfc: string) =>
      client.transaction.create({
        data: {
          userId,
          accountId: checking.id,
          source: "plaid",
          date: at(date),
          amountCents,
          description,
          pfcDetailed: pfc,
        },
      });
    await line(first, 1_250, "STARBUCKS", "FOOD_AND_DRINK_COFFEE");
    for (const d of pay) await line(d, cents, payer, "INCOME_SALARY");
    for (const p of payments)
      await line(p.date, p.cents, "IRS USATAXPYMT", "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT");
    return userId;
  }

  const fridays = (from: string, to: string) => {
    const out: string[] = [];
    for (let d = at(from).getTime(); d <= at(to).getTime(); d += 14 * DAY)
      out.push(new Date(d).toISOString().slice(0, 10));
    return out;
  };
  const semiMonthly = (from: string, to: string) => {
    const out: string[] = [];
    for (let y = 2026; y <= 2027; y++)
      for (let m = 1; m <= 12; m++)
        for (const d of [1, 15]) {
          const day = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          if (day >= from && day <= to) out.push(day);
        }
    return out;
  };

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
  });

  it("a 2026 estimate on 2027-02-10 holds no January 2027 paycheck; the 2027 estimate does", async () => {
    const id = await person("t7-next-january-pay@example.com", {
      first: "2025-11-14",
      pay: fridays("2025-11-14", "2027-02-05"),
    });
    const now = new Date("2027-02-10T20:00:00Z");
    const y2026 = await loadTaxEstimate(id, { client, now, year: 2026 });
    expect(y2026.paychecks.count).toBe(26);
    expect(y2026.paychecks.last).toBe("2026-12-25");
    expect(y2026.input.income.wagesCents).toBe(26 * -PAY);
    const y2027 = await loadTaxEstimate(id, { client, now, year: 2027 });
    expect(y2027.paychecks.count).toBe(3);
    expect(y2027.paychecks.last).toBe("2027-02-05");
  });

  it("a January 10, 2027 payment is 2026's fourth installment, not 2027's", async () => {
    const id = await person("t7-next-january-payment@example.com", {
      first: "2025-11-14",
      pay: fridays("2025-11-14", "2027-02-05"),
      payments: [{ date: "2027-01-10", cents: 150_000 }],
    });
    const now = new Date("2027-02-10T20:00:00Z");
    const y2026 = await loadTaxEstimate(id, { client, now, year: 2026 });
    expect(y2026.soFar.seenPaidCents).toBe(150_000);
    expect(y2026.assumptions.some((a) => /^Jane took/.test(a))).toBe(false);
    const y2027 = await loadTaxEstimate(id, { client, now, year: 2027 });
    expect(y2027.soFar.seenPaidCents).toBe(0);
  });

  it("January 16-31 counts for the year before, with its line", async () => {
    const id = await person("t7-next-january-late@example.com", {
      first: "2025-11-14",
      pay: fridays("2025-11-14", "2027-02-05"),
      payments: [{ date: "2027-01-20", cents: 90_000 }],
    });
    const now = new Date("2027-02-10T20:00:00Z");
    const y2026 = await loadTaxEstimate(id, { client, now, year: 2026 });
    expect(y2026.soFar.seenPaidCents).toBe(90_000);
    expect(y2026.assumptions.find((a) => /^Jane took/.test(a))).toMatch(
      /\$900\.00 paid on Jan 20, 2027 as a 2026 payment/,
    );
  });

  describe("a payment before the first installment's date", () => {
    const apr = [{ date: "2026-04-14", cents: 200_000 }];
    const now = new Date("2026-11-20T20:00:00Z");
    const line = (v: { assumptions: string[] }) => v.assumptions.find((a) => /^Jane took/.test(a));

    async function withReturn(email: string, owed: number, payments = apr) {
      const id = await person(email, {
        first: "2025-11-14",
        pay: fridays("2025-11-14", "2026-11-13"),
        payments,
      });
      const doc = await client.document.create({
        data: {
          userId: id,
          kind: "prior_return",
          fileName: "2025.pdf",
          contentType: "application/pdf",
          sizeBytes: 1,
          encryptedBytes: Buffer.from("x"),
        },
      });
      await client.priorReturn.create({
        data: {
          userId: id,
          documentId: doc.id,
          status: "confirmed",
          fields: { taxYear: "2025", refund: String(-owed) },
          sources: {},
          notes: {},
        },
      });
      return id;
    }

    it("equal to last year's balance due, no estimates paid last year: counted, with the line", async () => {
      const id = await withReturn("t7-april-balance@example.com", 2000);
      const v = await loadTaxEstimate(id, { client, now, year: 2026 });
      expect(v.soFar.seenPaidCents).toBe(200_000);
      expect(line(v)).toBe(
        "Jane took the $2,000.00 paid on Apr 14 as a 2026 estimate; it may be last year's balance.",
      );
    });

    it("estimates were paid last year: counted, no line", async () => {
      const id = await withReturn("t7-april-estimates@example.com", 2000, [
        ...apr,
        { date: "2025-09-15", cents: 100_000 },
      ]);
      const v = await loadTaxEstimate(id, { client, now, year: 2026 });
      expect(v.soFar.seenPaidCents).toBe(200_000);
      expect(line(v)).toBeUndefined();
    });

    it("not the balance due, or no return to say: counted, no line", async () => {
      const other = await withReturn("t7-april-other@example.com", 1234);
      expect(line(await loadTaxEstimate(other, { client, now, year: 2026 }))).toBeUndefined();
      const none = await person("t7-april-none@example.com", {
        first: "2025-11-14",
        pay: fridays("2025-11-14", "2026-11-13"),
        payments: apr,
      });
      const v = await loadTaxEstimate(none, { client, now, year: 2026 });
      expect(v.soFar.seenPaidCents).toBe(200_000);
      expect(line(v)).toBeUndefined();
    });
  });

  it("a stub from another year is not this year's pay", async () => {
    const id = await person("t7-stub-year@example.com", {
      first: "2025-11-14",
      pay: fridays("2025-11-14", "2027-02-05"),
    });
    await client.taxProfile.create({
      data: {
        userId: id,
        payAsOf: at("2027-01-20"),
        payGrossYtdCents: 400_000,
        payFederalYtdCents: 40_000,
      },
    });
    const now = new Date("2027-02-10T20:00:00Z");
    const y2026 = await loadTaxEstimate(id, { client, now, year: 2026 });
    expect(y2026.pay.source).toBe("none");
    expect(y2026.input.income.wagesCents).toBe(26 * -PAY);
    const y2027 = await loadTaxEstimate(id, { client, now, year: 2027 });
    expect(y2027.pay.source).toBe("pay_stub");
  });

  describe("the calendar across the new year, data held fixed", () => {
    const days: string[] = [];
    for (let d = at("2026-12-28").getTime(); d <= at("2027-01-20").getTime(); d += DAY)
      days.push(new Date(d).toISOString().slice(0, 10));
    const people: { name: string; id: () => string }[] = [];
    let worker = "";
    let student = "";

    beforeAll(async () => {
      worker = await person("t7-sweep-worker@example.com", {
        first: "2025-11-14",
        pay: fridays("2025-11-14", "2027-01-20"),
        payments: [{ date: "2026-06-15", cents: 100_000 }],
        timezone: "America/Los_Angeles",
      });
      // A TA from June 1 on the 1st and 15th, with her data beginning mid-year.
      student = await person("t7-sweep-student@example.com", {
        first: "2026-06-01",
        pay: semiMonthly("2026-06-01", "2027-01-20"),
        payer: "STANFORD UNIV DES:PAYROLL ID:X",
        cents: -150_000,
        timezone: "America/Los_Angeles",
      });
      people.push({ name: "worker", id: () => worker }, { name: "student", id: () => student });
    });

    // The 2026 figures on each day at 3pm Pacific (23:00Z) and 7pm Pacific (03:00Z next day).
    const figures = (v: Awaited<ReturnType<typeof loadTaxEstimate>>) =>
      JSON.stringify({
        year: v.year,
        wages: v.input.income.wagesCents,
        estimate: v.estimate,
        count: v.paychecks.count,
        last: v.paychecks.last,
        assumptions: v.assumptions,
      });

    it.each(["worker", "student"])(
      "%s: no day throws, 2026 holds still from Jan 1, 7pm equals 3pm",
      async (name) => {
        const id = people.find((p) => p.name === name)!.id();
        const byDay = new Map<string, string>();
        for (const d of days) {
          const three = new Date(`${d}T23:00:00Z`);
          const seven = new Date(new Date(`${d}T03:00:00Z`).getTime() + DAY);
          const a = await loadTaxEstimate(id, { client, now: three, year: 2026 });
          const b = await loadTaxEstimate(id, { client, now: seven, year: 2026 });
          expect(figures(b), `${name} ${d}`).toBe(figures(a));
          byDay.set(d, figures(a));
          // The default year stays 2026 until the roll date the code has (April 30).
          expect((await loadTaxEstimate(id, { client, now: three })).year).toBe(2026);
        }
        // Year over, data fixed: nothing in 2026 moves from Jan 1 to Jan 20. The one change on the
        // way, Dec 31 to Jan 1, is the year being whole instead of paced to its day (a year-over
        // estimate counts pay as it came), which the pace of the last 1/365th explains.
        const after = days.filter((d) => d >= "2027-01-01").map((d) => byDay.get(d));
        expect(new Set(after).size).toBe(1);
      },
    );

    it("the 3pm / 7pm check on December 31 and January 15, Los Angeles, either side of UTC midnight", async () => {
      for (const d of ["2026-12-31", "2027-01-15"]) {
        for (const id of [worker, student]) {
          const afternoon = await loadTaxEstimate(id, { client, now: new Date(`${d}T23:00:00Z`) });
          const evening = await loadTaxEstimate(id, {
            client,
            now: new Date(new Date(`${d}T03:00:00Z`).getTime() + DAY),
          });
          expect(figures(evening)).toBe(figures(afternoon));
        }
      }
    });
  });
});
