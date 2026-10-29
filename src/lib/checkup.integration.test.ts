import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { loadCheckup } from "./checkup";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-20T12:00:00Z");

describe.runIf(url)("the report's checkup against a real database", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `checkup-${crypto.randomUUID()}@example.com` } })
    ).id;
    const account = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 300_000,
      },
    });
    // Groceries every week for four months.
    const weeks = Array.from({ length: 17 }, (_, i) => {
      const d = new Date(NOW.getTime() - i * 7 * 86_400_000).toISOString().slice(0, 10);
      return {
        userId,
        accountId: account.id,
        source: "csv" as const,
        dedupeKey: `g-${d}`,
        date: new Date(`${d}T00:00:00Z`),
        amountCents: 25_000 + i * 113,
        description: "NEIGHBORHOOD GROCER",
        pfcPrimary: "FOOD_AND_DRINK",
        pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
        categorySource: "rule" as const,
      };
    });
    await client.transaction.createMany({ data: weeks });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("runs every check on the person's data", async () => {
    const lines = await loadCheckup(userId, [], { client, now: NOW });
    const of = (type: string) => lines.find((l) => l.type === type);

    expect(of("bank_fees")).toMatchObject({ status: "passed", line: "None in 4 months" });
    expect(of("insurance_reshop")?.status).toBe("not_enough_data");
    expect(lines.some((l) => l.type === "charge_after_cancel")).toBe(false);
  });

  it("says found for a finding the report lists", async () => {
    const lines = await loadCheckup(userId, ["card_interest", "card_interest"], {
      client,
      now: NOW,
    });
    expect(lines[0]).toMatchObject({ type: "card_interest", status: "found", line: "2 found" });
  });
});
