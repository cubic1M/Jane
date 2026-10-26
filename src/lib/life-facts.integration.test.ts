import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { syncItem } from "@/lib/plaid/sync";
import { clearCorrection, correctFact, loadProfile } from "@/lib/profile";
import { detectFor } from "@/lib/suggestions";
import { startTrial } from "@/lib/trial";

// Suggestions change with the facts (founder, 2026-10-26), through the database: the Reyes
// family's dog is read from their payments, cover for it is suggested, and when they say they
// have no dog it goes, and comes back when they take that back.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("life facts and suggestions, end to end", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];
  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const topics = async (userId: string) =>
    (await detectFor(userId, { client, now: NOW })).suggestions.map((s) => s.topic);

  it("reads the family's kids and dog, and cover for the dog follows the fact", async () => {
    const family = await startTrial({ client, now: NOW, defer: true, person: "family" });
    made.push(family.userId);
    await syncItem(family.itemId, { client, now: NOW });
    const facts = (await loadProfile(family.userId, { client, now: NOW })).facts;
    expect(facts.has_children.value).toBe(true);
    expect(facts.has_pet).toMatchObject({ value: true, source: "seen" });

    expect(await topics(family.userId)).toContain("pet_insurance");
    // They say they have no dog: the suggestion goes, and the fact is theirs at 100%.
    await correctFact(family.userId, "has_pet", "no", { client, now: NOW });
    expect((await loadProfile(family.userId, { client, now: NOW })).facts.has_pet).toMatchObject({
      value: false,
      source: "told",
      confidence: 100,
    });
    expect(await topics(family.userId)).not.toContain("pet_insurance");
    // They take it back: Jane goes back to what it sees.
    await clearCorrection(family.userId, "has_pet", { client });
    expect(await topics(family.userId)).toContain("pet_insurance");
  });

  it("someone with no pet is never offered cover for one, until they say they have one", async () => {
    const renter = await startTrial({ client, now: NOW, defer: true, person: "renter" });
    made.push(renter.userId);
    await syncItem(renter.itemId, { client, now: NOW });
    expect(await topics(renter.userId)).not.toContain("pet_insurance");
    await correctFact(renter.userId, "has_pet", "yes", { client, now: NOW });
    expect(await topics(renter.userId)).toContain("pet_insurance");
  });

  it("a homeowner is never pitched renters' cover, a renter is", async () => {
    const family = await startTrial({ client, now: NOW, defer: true, person: "family" });
    made.push(family.userId);
    await syncItem(family.itemId, { client, now: NOW });
    expect(await topics(family.userId)).not.toContain("renters_insurance");
    const renter = await startTrial({ client, now: NOW, defer: true, person: "renter" });
    made.push(renter.userId);
    await syncItem(renter.itemId, { client, now: NOW });
    expect(await topics(renter.userId)).toContain("renters_insurance");
  });
});
