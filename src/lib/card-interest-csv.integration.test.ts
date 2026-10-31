import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runDetectors } from "@/detectors";
import { PrismaClient } from "@/generated/prisma/client";
import { buildProfile } from "@/profile/build";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadProfileInput } from "@/lib/profile";

// Debugger 10-30: a Bank of America card uploaded as a statement file, charging interest for
// three months. The report's top card was "$141.00 in interest on BofA card", but the dock and
// the Loans area said nothing: a statement has no balance or rate, so the loader worked the
// year out as $0 and the suggestion took that $0 as known.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-30T18:00:00Z");

describe.runIf(url)("card interest from statement files", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `card-csv-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    const card = await client.account.create({
      data: { userId, source: "csv", name: "BofA card", type: "credit", subtype: "credit card" },
    });
    let n = 0;
    const row = (date: string, amountCents: number, description: string, pfcDetailed: string) =>
      client.transaction.create({
        data: {
          userId,
          accountId: card.id,
          source: "csv",
          dedupeKey: String(n++),
          date: new Date(`${date}T00:00:00Z`),
          amountCents,
          description,
          pfcPrimary: pfcDetailed.split("_").slice(0, 2).join("_"),
          pfcDetailed,
        },
      });
    for (const [date, cents] of [
      ["2026-08-27", 4_600],
      ["2026-09-27", 4_700],
      ["2026-10-27", 4_800],
    ] as const)
      await row(date, cents, "INTEREST CHARGED ON PURCHASES", "BANK_FEES_INTEREST_CHARGE");
    for (const date of ["2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"])
      await row(date, 6_000, "TRADER JOE S #072 OAKLAND CA", "FOOD_AND_DRINK_GROCERIES");
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("suggests paying the card down from the interest charges seen", async () => {
    const input = await loadProfileInput(userId, { client, now: NOW });
    const topics = runDetectors({ profile: buildProfile(input), data: input }).map((s) => s.topic);
    expect(topics).toContain("card_interest");
  });
});
