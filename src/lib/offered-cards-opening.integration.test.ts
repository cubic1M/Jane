import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { offeredCardsOpening } from "./offered-card";

// Debug 2's class 11 (11-22): budget billing, the energy and internet discounts and pay that
// stopped open Coming up beside the bill rate. The page shows every card offered that opens it.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-22T20:00:00Z");

describe.runIf(url)("the cards a page shows", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `opening-${crypto.randomUUID()}@example.com` } })
    ).id;
    const card = (key: string, actionHref: string, status = "selected") => ({
      userId,
      key,
      capability: key.split(":")[0]!,
      topic: key.split(":")[1]!,
      title: key,
      headline: `${key} headline`,
      worthCents: 10_000,
      worthKind: "saves",
      confidencePercent: 70,
      confidenceReason: "seen",
      urgency: "later",
      why: `${key} why`,
      actionLabel: "See",
      actionHref,
      status,
      selectedOn: new Date("2026-11-22T00:00:00Z"),
    });
    await client.suggestion.createMany({
      data: [
        card("cost:bill_negotiation", "/bills"),
        card("cost:budget_billing", "/bills#card"),
        card("taxes:charity_receipts", "/taxes?focus=life:giving"),
        card("cost:utility_discount", "/bills", "answered"),
      ],
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("are the offered ones whose link opens it", async () => {
    const shown = await offeredCardsOpening(userId, "/bills", { client, now: NOW });
    expect(shown.map((c) => c.key).sort()).toEqual([
      "cost:bill_negotiation",
      "cost:budget_billing",
    ]);
    expect(shown.find((c) => c.key === "cost:budget_billing")).toEqual({
      key: "cost:budget_billing",
      headline: "cost:budget_billing headline",
      why: "cost:budget_billing why",
    });
  });
});
