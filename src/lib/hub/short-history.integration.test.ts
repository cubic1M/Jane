import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { runDetection } from "@/detection/engine";
import { loadHubTop } from "./load";
import { cashFlowView } from "./view";

// Debugger 11-14: a student who uploaded one statement (26 days, Sep 29 to Oct 24) read "Next 30
// days: Nothing due in the next month" on Home. Through Home's own loader, against a real database:
// the strip says there's too little history, not that nothing is due.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-14T18:00:00Z");

describe.runIf(url)("Home's month ahead after one short statement", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: { email: `hub-short-${crypto.randomUUID()}@example.com` },
      })
    ).id;
    const account = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "BofA checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 834_337,
      },
    });
    const rows: [string, number, string][] = [
      ["2026-09-29", 525, "CHECKCARD 0928 DUTCH BROS #221 CHICAGO IL"],
      ["2026-10-01", 235_618, "Check 1142"],
      ["2026-10-08", 7_110, "EVERSOURCE DES:BILL PAY"],
      ["2026-10-24", 3_800, "CHECKCARD 1023 KINGS HEAD PUB CHICAGO IL"],
    ];
    await client.transaction.createMany({
      data: rows.map(([date, amountCents, description], i) => ({
        userId,
        accountId: account.id,
        source: "csv" as const,
        dedupeKey: `short-${i}`,
        date: new Date(`${date}T00:00:00Z`),
        amountCents,
        description,
      })),
    });
    await runDetection(userId, { client, now: NOW });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("says there's too little history to see bills", async () => {
    const top = await loadHubTop(userId, { client, now: NOW });
    const strip = cashFlowView(top!.cashFlow);
    expect(strip.events).toEqual([]);
    expect(strip.empty).toMatch(/^Too little history to see your bills yet/);
  });
});
