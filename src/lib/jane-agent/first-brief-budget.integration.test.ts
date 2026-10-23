import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

// What Jane keeps current by herself, counted: the first brief must not wait for any of it.
const { kept } = vi.hoisted(() => ({ kept: { calls: 0 } }));
vi.mock("@/lib/money-movement/bill-pay", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/money-movement/bill-pay")>();
  return {
    ...original,
    runBillPay: vi.fn(async (...args: Parameters<typeof original.runBillPay>) => {
      kept.calls += 1;
      return original.runBillPay(...args);
    }),
  };
});

import { syncItem } from "@/lib/plaid/sync";
import { scanSuggestions } from "@/lib/suggestions";
import { startTrial } from "@/lib/trial";
import { runJaneAgent } from "./run";

// The first brief has to reach a new person inside the host's 60 seconds, so the first run of
// a first scan leaves the upkeep to the scan's last run.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("the first brief's budget", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const trial = await startTrial({ client, now: NOW, defer: true, person: "retiree" });
    userId = trial.userId;
    await syncItem(trial.itemId, { client, now: NOW });
    await client.janeMessage.deleteMany({ where: { userId } });
    await scanSuggestions(userId, { client, now: NOW });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("posts the brief without the upkeep, which the last run does", async () => {
    kept.calls = 0;
    await runJaneAgent(userId, { client, now: NOW, trigger: "sync", early: true });
    expect(kept.calls).toBe(0);
    const agenda = await client.janeMessage.findMany({
      where: { userId, body: { contains: "from looking at your money" } },
    });
    expect(agenda.length).toBeGreaterThan(0);

    await client.janeMessage.deleteMany({ where: { userId } });
    await runJaneAgent(userId, { client, now: NOW, trigger: "sync" });
    expect(kept.calls).toBeGreaterThan(0);
  });
});
