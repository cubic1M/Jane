import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { debtBook } from "@/insights/debts";
import { paidLoans } from "@/insights/paid-loans";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/mortgage", () => ({ loadMortgage: vi.fn(async () => null) }));
const ROCKET = ["2026-08-01", "2026-09-01", "2026-10-01"].map((date) => ({
  date,
  amountCents: 512_000,
  description: "ROCKET MORTGAGE PMT PPD ID: 4455",
  merchantName: null,
  pfcDetailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
}));
const book = { current: debtBook({ accounts: [], plans: [], typed: [] }, "2026-10-30") };
vi.mock("@/lib/debts", () => ({ loadDebts: vi.fn(async () => book.current) }));

import { answerDebt } from "./debt-answer";

const ask = () =>
  answerDebt(
    "u1",
    { kind: "mortgage" },
    { client: {} as PrismaClient, now: new Date("2026-10-30T12:00:00Z") },
  );

// Night QA 10-30: "When is my mortgage due" answered "I don't see a mortgage in your accounts"
// for a person paying Rocket Mortgage $5,120 a month from checking.
describe("answerDebt, mortgage", () => {
  it("answers from a mortgage seen in payments", async () => {
    book.current = debtBook(
      { accounts: [], plans: [], typed: [], paid: paidLoans(ROCKET, "2026-10-30") },
      "2026-10-30",
    );
    const reply = await ask();
    expect(reply.body).toMatch(/^Your Rocket Mortgage Pmt mortgage: I don't know what's left/);
    expect(reply.body).toMatch(/You pay \$5,120\.00 a month, next on Nov 1\./);
  });

  it("still says so when there's no mortgage at all", async () => {
    book.current = debtBook({ accounts: [], plans: [], typed: [] }, "2026-10-30");
    expect((await ask()).body).toBe("I don't see a mortgage in your accounts.");
  });
});
