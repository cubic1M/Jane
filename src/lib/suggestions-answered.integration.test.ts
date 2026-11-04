import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { findingOfType } from "./__fixtures__/findings";
import { CARD_SELECT, buildCard, cardHash } from "./cards";
import { markDiyDone, recordDecision, undoDecision } from "./decisions";
import { scanSuggestions } from "./suggestions";

// Debugger 11-04: a person marked the bank fee card done, and /jane still led with "Stop paying
// overdraft and bank fees". A card and the scan's suggestion on the same topic are one thing to
// the person: once every card on a topic is answered it isn't suggested, until a new card comes.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-30T15:00:00Z");
const TOMORROW = new Date("2026-10-31T15:00:00Z");
const LIVE = ["waiting", "selected"];

describe.runIf(url)("a suggestion whose card has been answered", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];
  let sequence = 0;

  async function personWithFees() {
    const user = await client.user.create({
      data: { email: `answered-${crypto.randomUUID()}@example.com` },
    });
    made.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    let n = 0;
    for (const date of ["2026-08-26", "2026-09-26", "2026-10-26"]) {
      await client.transaction.create({
        data: {
          userId: user.id,
          accountId: account.id,
          source: "csv",
          dedupeKey: String(n++),
          date: new Date(`${date}T00:00:00Z`),
          amountCents: 1_500,
          description: "MONTHLY MAINTENANCE FEE",
          pfcPrimary: "BANK_FEES",
          pfcDetailed: "BANK_FEES_OTHER_BANK_FEES",
        },
      });
    }
    return user.id;
  }
  async function card(userId: string) {
    const sample = findingOfType("bank_fees");
    sequence += 1;
    const f = await client.finding.create({
      data: {
        userId,
        type: sample.type,
        key: `${sample.key}-${sequence}`,
        title: sample.title,
        annualSavingsCents: sample.annualSavingsCents,
        amountCents: sample.amountCents,
        confidence: sample.confidence,
        evidence: sample.evidence as Prisma.InputJsonObject,
      },
      select: CARD_SELECT,
    });
    return { findingId: f.id, cardHash: cardHash(buildCard(f)) };
  }
  const feeSuggestion = (userId: string) =>
    client.suggestion.findFirstOrThrow({ where: { userId, topic: "bank_fees" } });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
  });

  it("goes as soon as the card is marked done, and stays gone on later scans", async () => {
    const userId = await personWithFees();
    const answer = await card(userId);
    await scanSuggestions(userId, { client, now: NOW });
    expect(LIVE).toContain((await feeSuggestion(userId)).status);

    const { decisionId } = await recordDecision(
      userId,
      { ...answer, choice: "diy" },
      { client, now: NOW },
    );
    await markDiyDone(userId, decisionId, { client, now: NOW });
    expect((await feeSuggestion(userId)).status).toBe("gone");

    await scanSuggestions(userId, { client, now: TOMORROW });
    expect((await feeSuggestion(userId)).status).toBe("gone");
  });

  it("goes on a no, and comes back on the next scan if the no is undone", async () => {
    const userId = await personWithFees();
    const answer = await card(userId);
    await scanSuggestions(userId, { client, now: NOW });

    const { decisionId } = await recordDecision(
      userId,
      { ...answer, choice: "no" },
      { client, now: NOW },
    );
    expect((await feeSuggestion(userId)).status).toBe("gone");

    await undoDecision(userId, decisionId, { client, now: NOW });
    await scanSuggestions(userId, { client, now: TOMORROW });
    expect(LIVE).toContain((await feeSuggestion(userId)).status);
  });

  it("stays while another card on the topic is open, and comes back with a new card", async () => {
    const userId = await personWithFees();
    const first = await card(userId);
    await card(userId);
    await scanSuggestions(userId, { client, now: NOW });

    await recordDecision(userId, { ...first, choice: "no" }, { client, now: NOW });
    expect(LIVE).toContain((await feeSuggestion(userId)).status);

    await client.finding.updateMany({ where: { userId }, data: { status: "declined" } });
    await scanSuggestions(userId, { client, now: TOMORROW });
    expect((await feeSuggestion(userId)).status).toBe("gone");

    await card(userId);
    await scanSuggestions(userId, { client, now: new Date("2026-11-01T15:00:00Z") });
    expect(LIVE).toContain((await feeSuggestion(userId)).status);
  });
});
