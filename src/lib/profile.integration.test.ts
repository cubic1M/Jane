import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { parseIntent } from "@/lib/jane-agent/intents";
import { profileReply } from "@/lib/jane-agent/replies-profile";
import { syncItem } from "@/lib/plaid/sync";
import { startTrial } from "@/lib/trial";
import { clearCorrection, correctFact, loadProfile, parseAnswer, ProfileError } from "./profile";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("the picture of you, loaded", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const made = new Map<string, string>();

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    for (const p of PEOPLE) {
      const trial = await startTrial({ client, now: NOW, defer: true, person: p.id });
      await syncItem(trial.itemId, { client, now: NOW });
      made.set(p.id, trial.userId);
    }
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [...made.values()] } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it.each(PEOPLE)("$id's loaded profile matches their written description", async (person) => {
    const { facts } = await loadProfile(made.get(person.id)!, { client, now: NOW });
    expect(facts.income_pattern.value).toBe(person.facts.income);
    expect(facts.life_stage.value).toBe(person.facts.lifeStage);
    expect(facts.household.value).toBe(person.facts.household);
    expect(facts.housing.value).toBe(person.facts.owns === "home" ? "own" : "rent");
    expect(facts.debt_trouble.value).toBe(person.facts.hasDebtTrouble);
  });

  it("a correction is the person's word, reaches the older answers, and can be taken back", async () => {
    const userId = made.get("family")!;
    expect((await loadProfile(userId, { client, now: NOW })).facts.has_children.value).toBe(true);
    await correctFact(userId, "has_children", "no", { client, now: NOW });
    await correctFact(userId, "housing", "rent", { client, now: NOW });
    await correctFact(userId, "age", "41", { client, now: NOW });
    const after = (await loadProfile(userId, { client, now: NOW })).facts;
    expect(after.has_children).toMatchObject({ value: false, source: "told", confidence: 100 });
    expect(after.housing).toMatchObject({ value: "rent", source: "told" });
    expect(after.age).toMatchObject({ value: 41, source: "told" });
    expect(after.household.value).toBe("couple");
    // The tax, insurance and investor answers other sectors read say the same.
    expect((await client.taxProfile.findUniqueOrThrow({ where: { userId } })).childrenUnder17).toBe(
      0,
    );
    expect((await client.insuranceProfile.findUniqueOrThrow({ where: { userId } })).housing).toBe(
      "rent",
    );
    expect((await client.investorProfile.findUniqueOrThrow({ where: { userId } })).age).toBe(41);
    // Settings lists it as something Jane remembers.
    const prefs = await client.janePreference.findMany({
      where: { userId, key: { startsWith: "profile:" } },
    });
    expect(prefs.map((p) => p.key).sort()).toEqual([
      "profile:age",
      "profile:has_children",
      "profile:housing",
    ]);
    expect(await clearCorrection(userId, "housing", { client })).toBe(true);
    expect(await clearCorrection(userId, "housing", { client })).toBe(false);
  });

  it("checks what's typed, and answers in the chat", async () => {
    expect(parseAnswer("has_pet", "Yes")).toBe(true);
    expect(parseAnswer("monthly_income", "$4,200")).toBe(420_000);
    expect(parseAnswer("life_stage", "Retired")).toBe("retired");
    for (const [key, text] of [
      ["has_pet", "maybe"],
      ["life_stage", "wandering"],
      ["age", "old"],
      ["card_debt_cents", "5"],
      ["nonsense", "x"],
      ["employer", " "],
    ]) {
      expect(() => parseAnswer(key, text), `${key}: ${text}`).toThrow(ProfileError);
    }
    expect(parseIntent("What do you know about me?", "2026-10-18")).toEqual({ kind: "profile" });
    const reply = profileReply(await loadProfile(made.get("retiree")!, { client, now: NOW }));
    // A short paragraph built from the facts, each said as sure as Jane is (./jane-agent/who-am-i.ts).
    expect(reply.body).toMatch(/^Here's the picture I have of you/);
    expect(reply.body).toMatch(/correct it on your profile/);
    expect(reply.actions[0]).toMatchObject({ kind: "link", href: "/profile" });
  });
});
