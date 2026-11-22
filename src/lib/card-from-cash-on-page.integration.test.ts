import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
// No lending partner, as for a real account: the card interest page opens the report's finding.
vi.mock("@/lib/lender-partner", () => ({ lenderPartnerFor: vi.fn(async () => null) }));

import type { FindingType } from "@/generated/prisma/client";
import { formatCents } from "@/lib/money";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { savingsLine } from "@/lib/savings-text";
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

describe.runIf(url)("the card-from-cash figure on the page it opens", { timeout: 300_000 }, () => {
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
      await client.user.create({ data: { email: `card-cash-${crypto.randomUUID()}@example.com` } })
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

  it("pays off the card for the figure the report it opens says, with no lending partner", async () => {
    const userId = await demo();
    const finding = await client.finding.findFirstOrThrow({
      where: { userId, type: "card_interest", status: { in: ["new", "shown"] } },
      select: { type: true, annualSavingsCents: true, evidence: true, title: true },
    });
    const card = await suggestion(userId, "debt:card_from_cash");
    // The cash clears the whole card, so the card's year of interest is the report's.
    expect(card.worthCents).toBe(finding.annualSavingsCents);
    expect(card.why).toContain(`stops about ${formatCents(card.worthCents!)} a year of interest`);
    // The report's title says what that figure is: the interest of the last 12 months, by hand the
    // sum of the card's interest charges in the data's year, which the card's why counts at a
    // year's pace.
    expect(finding.title).toBe(
      `${formatCents(card.worthCents!)} in interest on Demo Credit Card in the last 12 months`,
    );
    // The report's own line says it (src/app/report/[findingId]/page.tsx).
    expect(
      savingsLine(finding.type as FindingType, finding.annualSavingsCents, finding.evidence),
    ).toBe(`Could save about ${formatCents(card.worthCents!)} a year`);
  });
});
