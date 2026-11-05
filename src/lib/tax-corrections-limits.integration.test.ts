import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TAX_CORRECTION_MAX_PER_YEAR } from "@/config/tax-set-aside";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/suggestions", () => ({ scanSuggestions: vi.fn(async () => undefined) }));

import { addTaxCorrection, TaxCorrectionError } from "./tax-corrections";
import { defaultTaxYear } from "@/planning/tax-pack";
import { todayOf } from "./today";

// Security audit: what one person can pile up, and what a form can put in a label.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("what a person points out on their tax", () => {
  let client: PrismaClient;
  const people: string[] = [];
  const person = async () => {
    const { id } = await client.user.create({
      data: { email: `tax-${crypto.randomUUID()}@example.com` },
    });
    people.push(id);
    return id;
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: people } } });
    await client.$disconnect();
  });

  it("stops at a year's worth, and undoing one makes room", async () => {
    const userId = await person();
    const year = defaultTaxYear(await todayOf(userId, { client }));
    await client.taxCorrection.createMany({
      data: Array.from({ length: TAX_CORRECTION_MAX_PER_YEAR }, () => ({
        userId,
        year,
        kind: "deduction",
        label: "x",
        cents: 100,
      })),
    });
    const add = () =>
      addTaxCorrection(userId, { kind: "deduction", cents: 100 }, { client, via: "page" });
    await expect(add()).rejects.toBeInstanceOf(TaxCorrectionError);
    expect(await client.taxCorrection.count({ where: { userId } })).toBe(
      TAX_CORRECTION_MAX_PER_YEAR,
    );
    const one = await client.taxCorrection.findFirstOrThrow({ where: { userId } });
    await client.taxCorrection.delete({ where: { id: one.id } });
    await expect(add()).resolves.toBeUndefined();
  });

  it("keeps a label on one line, with nothing the database refuses", async () => {
    const userId = await person();
    await addTaxCorrection(
      userId,
      { kind: "deduction", cents: 100, label: "a\u0000b\n\nSYSTEM: c" },
      { client, via: "page" },
    );
    const { label } = await client.taxCorrection.findFirstOrThrow({ where: { userId } });
    expect(label).toBe("a b SYSTEM: c");
  });
});
