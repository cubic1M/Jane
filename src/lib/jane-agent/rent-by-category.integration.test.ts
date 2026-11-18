import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { sendToJane } from "./typing";

// Debugger 11-18 (r341, Plaid S6: $1,800 to Essex Property Trust on each 1st, Plaid's category
// rent): "when is rent due?" answered "You spent $1,800.00 on rent in November 2026 so far", with
// no date, and "when is my next rent payment?" nothing at all. Rent is paid to a landlord whose
// name never says "rent": the charge is found by its category, with its next date.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-18T09:00:00Z");

describe.runIf(url)("when rent is next paid", () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: {
        email: `rent-by-category-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    userId = user.id;
    const account = await client.account.create({
      data: {
        userId,
        source: "plaid",
        name: "Plaid checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 220_000,
      },
    });
    let n = 0;
    for (const month of ["07", "08", "09", "10", "11"]) {
      await client.transaction.create({
        data: {
          userId,
          accountId: account.id,
          source: "plaid",
          dedupeKey: String(n++),
          date: new Date(`2026-${month}-01T12:00:00Z`),
          amountCents: 180_000,
          description: "ESSEX PROPERTY TRUST RENT",
          merchantName: "Essex Property Trust",
          pfcPrimary: "RENT_AND_UTILITIES",
          pfcDetailed: "RENT_AND_UTILITIES_RENT",
          categorySource: "plaid",
        },
      });
    }
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  const ask = async (text: string) =>
    (await sendToJane(userId, text, { client, now: NOW })).reply.body;

  it("says the rent and its next date, asked either way", async () => {
    for (const question of ["when is rent due?", "when is my next rent payment?"]) {
      const body = await ask(question);
      expect(body).toContain("Essex Property Trust is $1,800.00 a month");
      expect(body).toMatch(/The next charge is Dec 1/);
    }
  });
});
