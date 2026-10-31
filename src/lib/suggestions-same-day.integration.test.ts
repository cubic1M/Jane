import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { scanSuggestions } from "./suggestions";

// Debugger 10-31: a person uploaded checking, then a card. The day's scan ran with the first
// file (or mid-import), and the scan after the card returned early, keeping the day's picks and
// storing nothing new: the card's interest was the report's top card, but the dock and the Loans
// area ("All good") never had it until the next day. A same-day scan keeps its picks and now
// stores what newly fires as waiting, for the area pages.

const url = process.env.TEST_DATABASE_URL;
const MORNING = new Date("2026-10-30T15:00:00Z");
const LATER = new Date("2026-10-30T15:10:00Z");

describe.runIf(url)("a second scan on the same day", () => {
  let client: PrismaClient;
  let userId: string;
  let card: string;
  let n = 0;
  const row = (date: string, amountCents: number, description: string, pfcDetailed: string) =>
    client.transaction.create({
      data: {
        userId,
        accountId: card,
        source: "csv",
        dedupeKey: String(n++),
        date: new Date(`${date}T00:00:00Z`),
        amountCents,
        description,
        pfcPrimary: pfcDetailed.split("_").slice(0, 2).join("_"),
        pfcDetailed,
      },
    });

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `same-day-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    card = (
      await client.account.create({
        data: { userId, source: "csv", name: "BofA card", type: "credit", subtype: "credit card" },
      })
    ).id;
    for (const m of ["07", "08", "09", "10"])
      for (const day of ["04", "16"]) {
        await row(
          `2026-${m}-${day}`,
          2_499,
          "PLANET FITNESS 800-511-9442",
          "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
        );
        await row(`2026-${m}-${day}`, 6_000, "TRADER JOE S #072", "FOOD_AND_DRINK_GROCERIES");
      }
    // Two late fees: the morning scan has something to pick.
    for (const date of ["2026-08-26", "2026-09-26"])
      await row(date, 2_900, "LATE FEE FOR PAYMENT DUE", "BANK_FEES_LATE_FEES");
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("keeps the day's picks and stores what newly fires as waiting", async () => {
    const first = await scanSuggestions(userId, { client, now: MORNING });
    for (const [date, cents] of [
      ["2026-08-27", 4_600],
      ["2026-09-27", 4_700],
      ["2026-10-27", 4_800],
    ] as const)
      await row(date, cents, "INTEREST CHARGED ON PURCHASES", "BANK_FEES_INTEREST_CHARGE");
    expect(first.selected.length).toBeGreaterThan(0);
    const second = await scanSuggestions(userId, { client, now: LATER });
    expect(second.selected).toEqual(first.selected);
    const stored = await client.suggestion.findUnique({
      where: { userId_key: { userId, key: "debt:card_interest" } },
      select: { status: true, worthCents: true },
    });
    expect(stored).toMatchObject({ status: "waiting", worthCents: 42_300 });
  });

  // Review 10-31: one that had gone (it stopped firing) and fires again today comes back today,
  // and two scans at once don't trip over the same new row.
  it("brings back one that had gone, and survives two scans at once", async () => {
    await client.suggestion.update({
      where: { userId_key: { userId, key: "debt:card_interest" } },
      data: { status: "gone" },
    });
    await Promise.all([
      scanSuggestions(userId, { client, now: LATER }),
      scanSuggestions(userId, { client, now: LATER }),
    ]);
    const back = await client.suggestion.findUnique({
      where: { userId_key: { userId, key: "debt:card_interest" } },
      select: { status: true },
    });
    expect(back?.status).toBe("waiting");
  });
});
