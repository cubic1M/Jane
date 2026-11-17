import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("./opportunity-prefs", async (original) => {
  const actual = await original<typeof import("./opportunity-prefs")>();
  return { ...actual, scanPreferences: vi.fn(actual.scanPreferences) };
});

import { linkDemoBank } from "@/lib/plaid/demo";
import { scanSuggestions } from "@/lib/suggestions";
import { DEFAULT_SCAN_PREFERENCES } from "@/planning/practice-opportunities";
import { runAutopilot } from "./autopilot";
import { openPracticeIdeas } from "./ideas";
import { scanPreferences } from "./opportunity-prefs";
import { startPractice } from "./portfolio";
import { scanPractice } from "./scan";

// A practice idea waits seven of the person's days, not seven times 24 hours from the close it
// was found at (gate C's calendar sweep, 11-16: found at 21:30 UTC, it lapsed at 2:30pm in Los
// Angeles a week on, and the 7pm scan put away the idea the morning's had kept).

const url = process.env.TEST_DATABASE_URL;
const at = (iso: string) => new Date(iso);

describe.runIf(url)("a practice idea's seven days", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: {
        email: `practice-idea-days-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    userId = user.id;
    await linkDemoBank(userId, { client });
    await startPractice(userId, 2, { client, now: at("2026-09-01T21:30:00Z") });
    await runAutopilot(userId, { client, now: at("2026-09-01T21:30:00Z") });
    // Suggest-only, at the close on Oct 14: 2:30pm in Los Angeles.
    vi.mocked(scanPreferences).mockResolvedValueOnce({
      ...DEFAULT_SCAN_PREFERENCES,
      mode: "suggest",
    });
    await scanPractice(userId, { client, now: at("2026-10-14T21:30:00Z") });
  }, 180_000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  const ideas = async (now: Date) =>
    (await openPracticeIdeas(userId, { client, now })).map((i) => i.key).sort();
  const waiting = async () =>
    (
      await client.suggestion.findMany({
        where: { userId, key: { contains: ":practice_" }, status: { in: ["waiting", "selected"] } },
        select: { key: true },
      })
    )
      .map((s) => s.key)
      .sort();

  it("waits all of the seventh day after, at 8am, 3pm and 7pm alike, and is gone the next", async () => {
    const found = await ideas(at("2026-10-15T15:00:00Z"));
    expect(found.length).toBeGreaterThan(0);
    // Oct 21 in Los Angeles: 8am, 3pm, 7pm.
    expect(await ideas(at("2026-10-21T15:00:00Z"))).toEqual(found);
    expect(await ideas(at("2026-10-21T22:00:00Z"))).toEqual(found);
    expect(await ideas(at("2026-10-22T02:00:00Z"))).toEqual(found);
    // Oct 22, 8am.
    expect(await ideas(at("2026-10-22T15:00:00Z"))).toEqual([]);
  });

  it("is kept by the 7pm scan as by the morning's", async () => {
    await scanSuggestions(userId, { client, now: at("2026-10-21T15:00:00Z") });
    const morning = await waiting();
    expect(morning.length).toBeGreaterThan(0);
    await scanSuggestions(userId, { client, now: at("2026-10-22T02:00:00Z") });
    expect(await waiting()).toEqual(morning);
  });
});
