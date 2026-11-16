import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { scopedFor } from "./db-scoped";
import { findingSureFacts } from "./finding-sures";

// Gate C (11-16): a finding's "% sure: … in N months of data" counted the months to UTC's day, and
// an upload under 35 days old as reaching today. A statement from Jun 1 to Oct 20, uploaded Oct 21,
// read "4 months" at 3pm on Oct 24, "5 months" at 7pm (UTC's Oct 25) and "6 months" on Nov 24,
// with nothing new. It is the months the statement covers, as the profile counts them, every day
// and at any hour.

const url = process.env.TEST_DATABASE_URL;
const UPLOADED = new Date("2026-10-21T17:00:00Z");
// 3pm and 7pm in Los Angeles on Oct 24, and 3pm on Nov 24.
const MOMENTS = ["2026-10-24T22:00:00Z", "2026-10-25T02:00:00Z", "2026-11-24T23:00:00Z"];

describe.runIf(url)("the months of data a finding's sureness counts", () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: { email: "finding-sures-reach@example.test", timezone: "America/Los_Angeles" },
    });
    userId = user.id;
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    await client.transaction.createMany({
      data: [
        "2026-06-01",
        "2026-07-08",
        "2026-08-08",
        "2026-09-08",
        "2026-10-08",
        "2026-10-20",
      ].map((date, i) => ({
        userId,
        accountId: account.id,
        source: "csv" as const,
        dedupeKey: `sures-reach-${i}`,
        date: new Date(`${date}T00:00:00Z`),
        amountCents: 1_200,
        description: "MONTHLY SERVICE FEE",
        createdAt: UPLOADED,
      })),
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("is the statement's months at any hour and any day after", async () => {
    const months = [];
    for (const at of MOMENTS) {
      months.push(
        (await findingSureFacts(scopedFor(userId, client), new Date(at), { client })).months,
      );
    }
    expect(months[0]).toBeGreaterThan(0);
    expect(months).toEqual([months[0], months[0], months[0]]);
  });
});
