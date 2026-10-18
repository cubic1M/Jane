import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { findingOfType } from "./__fixtures__/findings";
import { CARD_SELECT, buildCard, cardHash } from "./cards";
import { recordDecision } from "./decisions";
import { partnerFor, partnerForUser } from "./referrals";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("referral partners against a real database", () => {
  let client: PrismaClient;
  const suffix = crypto.randomUUID().slice(0, 8);
  const users: string[] = [];
  const partnerKey = `bank-${suffix}`;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    await client.referralPartner.create({
      data: {
        key: partnerKey,
        name: "Example Bank",
        actionType: "card_interest",
        disclosure: "We may earn a referral fee from Example Bank.",
        referralUrl: "https://example.com/r",
        allowedStates: ["CA"],
        active: true,
      },
    });
    // Even switched on in the database, insurance stays off without counsel's answer.
    await client.referralPartner.create({
      data: {
        key: `insure-${suffix}`,
        name: "Example Insurance",
        actionType: "insurance_reshop",
        disclosure: "We may earn a fee.",
        referralUrl: "https://example.com/i",
        allowedStates: ["CA"],
        active: true,
      },
    });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.referralPartner.deleteMany({ where: { key: { endsWith: suffix } } });
    await client.$disconnect();
  });

  const person = async (state: string | null) => {
    const user = await client.user.create({
      data: { email: `ref-${crypto.randomUUID()}@example.com`, state },
    });
    users.push(user.id);
    return user.id;
  };

  it("offers a partner only where it's allowed", async () => {
    expect((await partnerFor("card_interest", "CA", { client }))?.key).toBe(partnerKey);
    expect(await partnerFor("card_interest", "NY", { client })).toBeNull();
    expect(await partnerFor("card_interest", null, { client })).toBeNull();
    expect(await partnerFor("insurance_reshop", "CA", { client })).toBeNull();
  });

  it("turns off instantly: the next card has no partner, and an answer to the old card is refused", async () => {
    const userId = await person("CA");
    const f = findingOfType("card_interest");
    const finding = await client.finding.create({
      data: {
        userId,
        type: f.type,
        key: f.key,
        title: f.title,
        annualSavingsCents: f.annualSavingsCents,
        confidence: f.confidence,
        evidence: f.evidence as Prisma.InputJsonObject,
      },
      select: CARD_SELECT,
    });
    const shown = buildCard(finding, await partnerForUser(userId, "card_interest", { client }));
    expect(shown.referralDisclosure).toBe("We may earn a referral fee from Example Bank.");

    await client.referralPartner.update({ where: { key: partnerKey }, data: { active: false } });

    expect(await partnerForUser(userId, "card_interest", { client })).toBeNull();
    await expect(
      recordDecision(
        userId,
        { findingId: finding.id, choice: "yes", cardHash: cardHash(shown) },
        { client },
      ),
    ).rejects.toMatchObject({ code: "card_changed" });

    await client.referralPartner.update({ where: { key: partnerKey }, data: { active: true } });
  });
});
