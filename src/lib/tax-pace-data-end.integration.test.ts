import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The loaders read the default client: the test database here.
vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { PrismaClient } from "@/generated/prisma/client";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { madeUpChaseCsv } from "@/lib/__fixtures__/made-up-statement";
import { scopedFor } from "./db-scoped";
import { finishImport } from "./import/background";
import { saveUpload } from "./import/upload";
import { loadTaxEstimate } from "./tax-estimate";

// Gate C's calendar sweep (src/sweep/), 11-16: a statement through Oct 22 (pay on the 1st and the
// 15th), uploaded Oct 25. The tax estimate counted the year to today while the newest pay was under
// two weeks old, so it sank a little each day ($13,958, $13,805, $13,654), then took the newest pay
// as where the data ended and jumped to $15,969 on Oct 30. The data ends at the statement's last
// line, from the day it's uploaded.

const url = process.env.TEST_DATABASE_URL;
const UPLOADED = new Date("2026-10-25T15:00:00Z");
// 3pm in Los Angeles, 4, 7 and 9 days after the statement's last line.
const DAYS = ["2026-10-26T22:00:00Z", "2026-10-29T22:00:00Z", "2026-10-31T22:00:00Z"];

describe.runIf(url)("an uploaded statement's tax pace", { timeout: 180_000 }, () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: { email: "tax-pace-data-end@example.test", timezone: "America/Los_Angeles" },
    });
    userId = user.id;
    const form = new FormData();
    form.set("accountId", "new");
    form.set("new.name", "Made-up checking");
    form.set("new.kind", "checking");
    form.append(
      "files",
      new File([madeUpChaseCsv("ZZTAXPACE", UPLOADED)], "statement.csv", { type: "text/csv" }),
    );
    const saved = await saveUpload(scopedFor(userId, client), form, { client });
    if (!saved.ok) throw new Error(saved.error);
    await finishImport(userId, saved.runId, { client, now: UPLOADED });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("is the same every day after, nothing new in the data", async () => {
    const totals = [];
    for (const at of DAYS) {
      const now = new Date(at);
      totals.push((await loadTaxEstimate(userId, { client, now }))?.estimate.totalTaxCents);
    }
    expect(totals[0]).toBeGreaterThan(0);
    expect(totals).toEqual([totals[0], totals[0], totals[0]]);
  });
});
