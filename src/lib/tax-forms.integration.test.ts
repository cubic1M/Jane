import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { loadTaxForms } from "./tax-organizer";

// The forms a person's own rows expect, through the loader the pages use (debugger 11-02): the
// lender's 1098 passed a test of the pure function but never reached a page, because the loader
// read only income; and a seller's PayPal customers were listed as sending 1099s.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-02T16:00:00Z");

describe.runIf(url)("the tax forms a person's rows expect", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  const person = async () => {
    const user = await client.user.create({
      data: { email: `tax-forms-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  };
  const rows = async (
    userId: string,
    account: { name: string; subtype: string },
    list: [string, number, string][],
  ) => {
    const { id } = await client.account.create({
      data: { userId, source: "csv", type: "depository", ...account },
    });
    await client.transaction.createMany({
      data: list.map(([merchantName, amountCents, pfcDetailed], i) => ({
        userId,
        accountId: id,
        source: "csv" as const,
        dedupeKey: `${account.name}-${i}`,
        date: new Date(`2026-0${(i % 9) + 1}-02T00:00:00Z`),
        amountCents,
        description: merchantName,
        merchantName,
        pfcPrimary: pfcDetailed.split("_").slice(0, 2).join("_"),
        pfcDetailed,
      })),
    });
  };
  const forms = async (userId: string) =>
    (await loadTaxForms(userId, 2026, { client, now: NOW })).forms.map((f) => [f.form, f.from]);

  it("expects a 1098 and a 1098-E from lenders seen only in payments", async () => {
    const me = await person();
    await rows(me, { name: "Chase Checking", subtype: "checking" }, [
      ["Mr Cooper", 172_000, "LOAN_PAYMENTS_MORTGAGE_PAYMENT"],
      ["Mr Cooper", 172_000, "LOAN_PAYMENTS_MORTGAGE_PAYMENT"],
      ["Nelnet", 31_244, "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT"],
    ]);
    expect(await forms(me)).toEqual([
      ["1098", "Mr Cooper"],
      ["1098-E", "Nelnet"],
    ]);
  });

  it("expects one form from a payment app, not one from each customer", async () => {
    const me = await person();
    await rows(me, { name: "Citizens Checking", subtype: "checking" }, [
      ["Etsy Inc Payout", -545_501, "INCOME_GIG_ECONOMY"],
    ]);
    await rows(me, { name: "PayPal", subtype: "paypal" }, [
      ["Jo Rivera", -37_100, "INCOME_GIG_ECONOMY"],
      ["Avery Stone", -34_454, "INCOME_GIG_ECONOMY"],
      ["Kai Morgan", -22_163, "INCOME_GIG_ECONOMY"],
    ]);
    expect(await forms(me)).toEqual([
      ["1099-NEC or 1099-K", "Etsy Inc Payout"],
      ["1099-NEC or 1099-K", "PayPal"],
    ]);
  });
});
