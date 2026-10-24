import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { PEOPLE, type PersonId } from "@/config/people";
import { loanPaymentCents } from "@/insights/debts";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { remainingMonths } from "@/planning/refinance";
import { loadDebts } from "./debts";
import { loadHomeEquity } from "./home-equity";
import { loadMortgage } from "./mortgage";
import { ensureChecked, loadRefinance } from "./refinance";
import { loadStudentLoans } from "./student-loans";

// Loans QA against a real database, for the eight sample people and the default demo person:
// "your payment" on a loan is one figure. The sample loans agree with themselves (the payoff
// date is where the balance, rate and payment end it), and the debts list, the refinance
// page's "keeping it", the student plans' "your plan now", the mortgage's extra-principal
// scenarios and its escrow split all use the same payment (a mortgage's without its escrow).

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const AS_OF = "2026-10-18";

const monthsTo = (day: string) =>
  (Number(day.slice(0, 4)) - 2026) * 12 + Number(day.slice(5, 7)) - 10;

describe.runIf(url)("one payment for each loan, everywhere", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  for (const who of [undefined, ...PEOPLE.map((p) => p.id)] as (PersonId | undefined)[]) {
    it(`agrees for ${who ?? "the default demo person"}`, { timeout: 300_000 }, async () => {
      const user = await client.user.create({
        data: { email: `payment-${who ?? "demo"}-${crypto.randomUUID()}@example.com` },
      });
      created.push(user.id);
      const opts = { client, now: NOW };
      const { itemId } = await linkDemoBank(user.id, { ...opts, person: who });
      await syncItem(itemId, { client, api: plaid, now: NOW });
      await ensureChecked(user.id, opts);
      const book = await loadDebts(user.id, opts);
      const loans = book.debts.filter(
        (d) => ["mortgage", "student", "auto", "loan"].includes(d.kind) && d.accountId,
      );
      const refi = await loadRefinance(user.id, opts);
      for (const loan of loans) {
        const payment = loanPaymentCents(loan);
        expect(payment, loan.name).toBeGreaterThan(0);
        // The sample loan agrees with itself: its payment ends it on its payoff date.
        expect(remainingMonths(loan, AS_OF), loan.name).toBe(monthsTo(loan.payoffDate!));
        if (loan.kind === "mortgage") {
          // The escrow is the rest of the payment, never less than nothing.
          expect(loan.principalAndInterestCents, loan.name).toBeGreaterThan(0);
          expect(loan.principalAndInterestCents!, loan.name).toBeLessThanOrEqual(
            loan.paymentCents!,
          );
        } else {
          expect(payment, loan.name).toBe(loan.paymentCents);
        }
        // Step 111's "keeping it" is the same payment.
        const c = refi.comparisons.find((x) => x.debtKey === loan.key);
        if (c) expect(c.currentMonthlyCents, loan.name).toBe(payment);
        // A mortgage's says it's principal and interest, with the escrow that stays.
        if (c && loan.kind === "mortgage") {
          // Priya's has none (her jumbo loan's payment is all principal and interest): no note.
          const escrow = loan.paymentCents! - payment!;
          expect(c.escrowCents, loan.name).toBe(escrow > 0 ? escrow : undefined);
        }
      }

      const student = await loadStudentLoans(user.id, opts);
      if (student.loan) {
        const now = student.comparison?.results.find((r) => r.plan === "current");
        expect(now?.monthlyNowCents, "student").toBe(loanPaymentCents(student.loan));
        const c = refi.comparisons.find((x) => x.debtKey === student.loan!.key);
        // The same months to pay it off at that payment.
        if (c && now) expect(now.months, "student").toBe(remainingMonths(student.loan, AS_OF));
      }

      const mortgage = await loadMortgage(user.id, opts);
      if (mortgage) {
        const pi = loanPaymentCents(mortgage.loan)!;
        // Extra principal is measured from the loan's own payoff at its principal and interest.
        expect(mortgage.extra?.baseMonths, "mortgage").toBe(remainingMonths(mortgage.loan, AS_OF));
        const equity = await loadHomeEquity(user.id, { ...opts, mortgage });
        expect(equity.paymentCents, "mortgage").toBe(mortgage.loan.paymentCents);
        expect(pi).toBe(mortgage.loan.principalAndInterestCents);
      }
    });
  }
});
