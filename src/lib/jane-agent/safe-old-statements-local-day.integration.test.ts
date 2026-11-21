import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { BALANCE_ROLL_MAX_DAYS } from "@/config/detection";
import { answerByRules } from "./answer";
import { parseIntent } from "./intents";

// Gate C's calendar sweep (src/sweep/), 11-16: whether statements were too old for safe to spend
// was counted in hours since their last day's UTC midnight. On the day they turned old, "what's
// safe to spend?" asked for a checking balance at 3pm in Los Angeles and said "Your statements end
// …" at 7pm. The person's own day decides. The answer turns where safe to spend stops walking the
// statements to today, BALANCE_ROLL_MAX_DAYS (manager, 11-20), no longer at STALE_UPLOAD_DAYS.

const url = process.env.TEST_DATABASE_URL;
const LAST = "2026-10-01";
const at = (day: string, utcHour: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + utcHour * 3_600_000);
// 3pm and 7pm in Los Angeles (UTC-8 after Nov 1): 23:00 the same UTC day, 03:00 the next.
const afternoon = (day: string) => at(day, 23);
const evening = (day: string) => at(day, 27);
const daysAfterLast = (n: number) =>
  new Date(Date.parse(`${LAST}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe.runIf(url)("safe to spend from old statements, all day", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: { email: "safe-old-day@example.test", timezone: "America/Los_Angeles" },
    });
    userId = user.id;
    // An uploaded checking account with no balance, its statement ending Oct 1.
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    await client.transaction.createMany({
      data: [
        ["2026-09-15", 4_200, "SAFEWAY STORE"],
        [LAST, -180_000, "ACME PAYROLL"],
      ].map(([date, amountCents, description], i) => ({
        userId,
        accountId: account.id,
        source: "csv" as const,
        dedupeKey: `safe-old-day-${i}`,
        date: new Date(`${date}T00:00:00Z`),
        amountCents: amountCents as number,
        description: description as string,
      })),
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const ask = async (now: Date) =>
    (
      await answerByRules(userId, parseIntent("what's safe to spend", "2026-11-01"), {
        client,
        now,
      })
    )?.body;

  it("gives one answer at 3pm and at 7pm, on the last day they're recent and the first they're old", async () => {
    for (const n of [BALANCE_ROLL_MAX_DAYS - 1, BALANCE_ROLL_MAX_DAYS, BALANCE_ROLL_MAX_DAYS + 1]) {
      const day = daysAfterLast(n);
      expect(await ask(evening(day)), day).toBe(await ask(afternoon(day)));
    }
    expect(await ask(evening(daysAfterLast(BALANCE_ROLL_MAX_DAYS)))).not.toMatch(
      /^Your statements/,
    );
    expect(await ask(afternoon(daysAfterLast(BALANCE_ROLL_MAX_DAYS + 1)))).toMatch(
      /^Your statements end Oct 1, 2026/,
    );
  });
});
