import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { demoPaystubs } from "@/data-sources/demo/demo-payroll";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { linkDemoBank } from "@/lib/plaid/demo";
import { openEnrollmentAtWork } from "./benefits";

// Gate C's calendar sweep (src/sweep/), 11-16: the demo payroll read UTC's day. At 7pm on Nov 13
// in Los Angeles UTC is already the 14th, so the last day of ACME's open enrollment dropped off
// Home, the cash-flow strip and the chat's "what's coming up" while it was still the 13th for
// the person, and next year's window took its place.

const url = process.env.TEST_DATABASE_URL;
// 3pm and 7pm on Nov 13 in Los Angeles; 7pm is already Nov 14 in UTC.
const AFTERNOON = new Date("2026-11-13T23:00:00Z");
const EVENING = new Date("2026-11-14T03:00:00Z");

describe("the demo pay stubs on a day", () => {
  it("gives the stub of the last payday on or before it", () => {
    expect(demoPaystubs("2026-11-14").map((s) => s.payDate)).toEqual(["2026-11-01", "2026-10-15"]);
    expect(demoPaystubs("2026-11-15").map((s) => s.payDate)).toEqual(["2026-11-15", "2026-11-01"]);
    expect(demoPaystubs("2027-01-10").map((s) => s.payDate)).toEqual(["2027-01-01", "2026-12-15"]);
  });

  it("keeps this year's open enrollment through its last day", () => {
    expect(demoPaystubs("2026-11-13")[0].openEnrollment?.end).toBe("2026-11-13");
    expect(demoPaystubs("2026-11-14")[0].openEnrollment?.end).toBe("2027-11-13");
  });
});

describe.runIf(url)("open enrollment at work on the person's own day", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    await client.user.deleteMany({ where: { email: "payroll-day@example.test" } });
    const user = await client.user.create({
      data: { email: "payroll-day@example.test", timezone: "America/Los_Angeles" },
    });
    userId = user.id;
    await linkDemoBank(userId, { client, now: AFTERNOON });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("is the same window at 7pm as at 3pm on its last day", async () => {
    const afternoon = await openEnrollmentAtWork(userId, { client, now: AFTERNOON });
    expect(afternoon).toMatchObject({ start: "2026-11-02", end: "2026-11-13" });
    expect(await openEnrollmentAtWork(userId, { client, now: EVENING })).toEqual(afternoon);
  });
});
