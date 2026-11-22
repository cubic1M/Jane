import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { scanSuggestions } from "@/lib/suggestions";
import { stubTestKeys } from "@/lib/__fixtures__/env";

// Debug 2's link check (sweep 16, 11-22), the demo person: "Ask for a lower bill rate, save
// $1,080/yr" opened Coming up, which shows neither $1,080 nor how it was worked out; "Pay off your
// card from cash, save $554/yr" opened the card interest report, which counted $386.95. A card with
// a figure opens a page that shows that figure and its working (the manager's rule).

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-22T20:00:00Z");
const api = new Proxy(
  {},
  {
    get: () => () => {
      throw new Error("no Plaid");
    },
  },
) as PlaidApi;

describe.runIf(url)("a card's figure on the page it opens", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];

  beforeAll(() => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
  });

  const demo = async () => {
    const userId = (
      await client.user.create({ data: { email: `card-fig-${crypto.randomUUID()}@example.com` } })
    ).id;
    made.push(userId);
    const { itemId } = await linkDemoBank(userId, { client, now: NOW });
    await syncItem(itemId, { client, api, now: NOW });
    await scanSuggestions(userId, { client, now: NOW });
    return userId;
  };
  const suggestion = (userId: string, key: string) =>
    client.suggestion.findUniqueOrThrow({
      where: { userId_key: { userId, key } },
      select: { headline: true, why: true, worthCents: true, actionHref: true },
    });

  it("asks a lower rate on the phone and internet bills the report found, worked out on /bills", async () => {
    const userId = await demo();
    const bills = (
      await client.finding.findMany({
        where: { userId, type: "bill_negotiation", status: { in: ["new", "shown"] } },
        select: { annualSavingsCents: true, evidence: true },
      })
    ).filter((f) => (f.evidence as { dispute?: boolean }).dispute !== true);
    // By hand: Comcast $165.00 a month against a typical top of $120.00, and Verizon $145.00
    // against $100.00: $45.00 a month each, $540.00 a year each, $1,080.00.
    expect(bills.map((f) => f.annualSavingsCents)).toEqual([54_000, 54_000]);
    const card = await suggestion(userId, "cost:bill_negotiation");
    expect(card.worthCents).toBe(108_000);
    expect(card.headline).toBe("Ask for a lower bill rate, save $1,080 a year");
    // What /bills#ask shows: the card's headline and this working.
    expect(card.why).toBe(
      "Comcast is $165.00 a month, $45.00 above the typical top of $120.00; Verizon Wireless is $145.00 a month, $45.00 above the typical top of $100.00. Brought down to the typical price, that's $1,080.00 a year.",
    );
    expect(card.actionHref).toBe("/bills#ask");
  });
});
