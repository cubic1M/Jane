import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { startPractice } from "./portfolio";
import {
  loadPreferences,
  practiceProfileOf,
  questionnaireLevel,
  savePreferences,
} from "./preferences";

// The practice preferences against a real, migrated Postgres: defaults with no row, one check
// for every change, scoped to the person, mirrored into the portfolio and audit-logged.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-22T15:00:00Z");

describe.runIf(url)("practice preferences", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const person = async () => {
    const user = await client.user.create({
      data: { email: `prefs-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  beforeEach(() => vi.mocked(logAudit).mockClear());
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("reads the defaults when nothing is saved", async () => {
    const id = await person();
    const p = await loadPreferences(id, { client });
    expect(p.riskLevel).toBeNull();
    expect(p.mode).toBe("act");
    expect(await client.practicePreferences.count({ where: { userId: id } })).toBe(0);
  });

  it("starts from what the person leaves out of their funds (step 236)", async () => {
    const id = await person();
    await client.valuesPreference.create({ data: { userId: id, excludes: ["tobacco"] } });
    expect((await loadPreferences(id, { client })).avoid).toEqual(["tobacco"]);
    // Once they choose here, theirs stands.
    await savePreferences(id, { avoid: [] }, "page", { client, now: NOW });
    expect((await loadPreferences(id, { client })).avoid).toEqual([]);
  });

  it("saves a change, audit-logs which fields and where from, and reads it back", async () => {
    const id = await person();
    const r = await savePreferences(
      id,
      { riskLevel: 2, avoid: ["fossil_fuels"], goal: "home", goalDate: "2030-01-01" },
      "chat",
      { client, now: NOW },
    );
    expect(r.ok).toBe(true);
    const p = await loadPreferences(id, { client });
    expect(p).toMatchObject({
      riskLevel: 2,
      avoid: ["fossil_fuels"],
      goal: "home",
      goalDate: "2030-01-01",
    });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id },
      "practice_preferences_changed",
      { type: "user", id },
      { changed: "riskLevel,goal,goalDate,avoid", via: "chat", simulated: "true" },
    );
  });

  it("refuses a bad change and saves nothing", async () => {
    const id = await person();
    const r = await savePreferences(id, { riskLevel: 2, mode: "real" }, "page", {
      client,
      now: NOW,
    });
    expect(r.ok).toBe(false);
    expect(await client.practicePreferences.count({ where: { userId: id } })).toBe(0);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("writes nothing when nothing changed", async () => {
    const id = await person();
    const r = await savePreferences(id, { appetite: "normal" }, "page", { client, now: NOW });
    expect(r.ok && r.changed).toEqual([]);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("keeps one person's preferences from another's", async () => {
    const a = await person();
    const b = await person();
    await savePreferences(a, { appetite: "off" }, "page", { client, now: NOW });
    expect((await loadPreferences(b, { client })).appetite).toBe("normal");
    expect((await loadPreferences(a, { client })).appetite).toBe("off");
  });

  it("starts the portfolio with the person's monthly money and mirrors later changes", async () => {
    const id = await person();
    await savePreferences(id, { monthlyAddCents: 20_000, addDay: 15 }, "page", {
      client,
      now: NOW,
    });
    await startPractice(id, 3, { client, now: NOW });
    let row = await client.practicePortfolio.findUniqueOrThrow({ where: { userId: id } });
    expect(row).toMatchObject({ monthlyAddCents: 20_000, addDay: 15, level: 3 });
    await savePreferences(id, { riskLevel: 1, addDay: 2 }, "chat", { client, now: NOW });
    row = await client.practicePortfolio.findUniqueOrThrow({ where: { userId: id } });
    expect(row).toMatchObject({ level: 1, addDay: 2 });
  });

  it("finds the questionnaire's level from the investor profile", async () => {
    const id = await person();
    expect(await questionnaireLevel(id, { client, now: NOW })).toBeNull();
    await client.investorProfile.create({
      data: { userId: id, horizon: "over_20", dropReaction: "worry", goals: ["growth"] },
    });
    expect(await questionnaireLevel(id, { client, now: NOW })).toBe(3);
  });

  it("builds the profile from the portfolio's level until one is chosen", async () => {
    const id = await person();
    expect((await practiceProfileOf(id, { client, now: NOW })).level).toBe(3);
    await startPractice(id, 5, { client, now: NOW });
    expect((await practiceProfileOf(id, { client, now: NOW })).level).toBe(5);
    await savePreferences(id, { riskLevel: 2, mode: "suggest" }, "page", { client, now: NOW });
    const p = await practiceProfileOf(id, { client, now: NOW });
    expect(p.level).toBe(2);
    expect(p.trades).toBe(false);
  });
});
