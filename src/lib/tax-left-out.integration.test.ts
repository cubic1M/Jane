import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { loadTaxEstimate } from "./tax-estimate";

// Debugger 11-06: a photographer paid in client checks by mobile deposit had $11,366 of them
// neither counted nor mentioned in the tax estimate.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-06T15:00:00Z");

describe.runIf(url)("money in the tax estimate can't place", () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  async function person(rows: { date: string; cents: number; pfc: string; what: string }[]) {
    const user = await client.user.create({
      data: { email: `tax-left-out-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: {
        userId: user.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    for (const r of rows) {
      await client.transaction.create({
        data: {
          userId: user.id,
          accountId: account.id,
          source: "csv",
          date: new Date(`${r.date}T00:00:00Z`),
          amountCents: r.cents,
          description: r.what,
          pfcPrimary: r.pfc.split("_").slice(0, 2).join("_"),
          pfcDetailed: r.pfc,
        },
      });
    }
    return user.id;
  }
  const stripe = ["01", "03", "05", "07", "09"].map((m) => ({
    date: `2026-${m}-12`,
    cents: -300_000,
    pfc: "INCOME_CONTRACTOR",
    what: "STRIPE TRANSFER",
  }));

  it("says how much came in by check that it left out", async () => {
    const checks = ["02", "06", "08"].map((m) => ({
      date: `2026-${m}-20`,
      cents: -300_000,
      pfc: "TRANSFER_IN_DEPOSIT",
      what: "MOBILE DEPOSIT",
    }));
    const view = (await loadTaxEstimate(await person([...stripe, ...checks]), {
      client,
      now: NOW,
    }))!;
    expect(view.assumptions.join(" ")).toMatch(
      /\$9,000\.00 more came in this year that I can't place/,
    );
  });

  it("never counts a move from the person's own savings", async () => {
    const moves = ["02", "06", "08"].map((m) => ({
      date: `2026-${m}-20`,
      cents: -300_000,
      pfc: "TRANSFER_IN_ACCOUNT_TRANSFER",
      what: "TRANSFER FROM SAVINGS",
    }));
    const view = (await loadTaxEstimate(await person([...stripe, ...moves]), {
      client,
      now: NOW,
    }))!;
    expect(view.assumptions.join(" ")).not.toMatch(/can't place/);
  });
});
