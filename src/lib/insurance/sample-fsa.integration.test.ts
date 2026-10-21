import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { syncItem } from "@/lib/plaid/sync";
import { startTrial } from "@/lib/trial";
import { loadHealthYear } from "./health-year";

// QA: every sample person was told "You have $2,400.00 left in your FSA". An FSA is a workplace
// benefit, so only the sample people who work for an employer have one.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("the sample FSA", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];
  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it.each([
    ["family", true],
    ["renter", true],
    ["freelancer", false],
    ["retiree", false],
    ["owner", false],
  ] as const)("%s has an FSA: %s", async (person, has) => {
    const trial = await startTrial({ client, now: NOW, defer: true, person });
    made.push(trial.userId);
    await syncItem(trial.itemId, { client, now: NOW });
    const year = await loadHealthYear(trial.userId, { client, now: NOW });
    expect(Boolean(year?.fsa)).toBe(has);
  });
});
