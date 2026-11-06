import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Saving a person's own credit report: off until the connector's switch and their read_credit
// consent, and only the derived fields are kept.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
const flags = vi.hoisted(() => ({ real: {} as Record<string, boolean> }));
vi.mock("@/config/connectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/connectors")>()),
  REAL_CONNECTORS: flags.real,
}));

import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { db } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import { realPerson, removePeople, trialPerson } from "../__fixtures__/people";
import { grantConsent } from "../consent";
import { saveCreditUpload } from "./upload";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: reads the saved credit report", db);
const NOW = new Date("2026-11-06T15:00:00Z");
const REPORT = {
  bureau: "transunion",
  reportDate: "2026-11-02",
  name: "Alex Sample",
  openCards: [{ limitCents: 400_000, balanceCents: 100_000 }],
  oldestAccountMonths: 60,
  averageAgeMonths: 30,
  hardInquiries12m: 1,
  late24m: { days30: 0, days60: 0, days90: 0 },
  collections: [],
};
const SCORE = { model: "fico_8", score: 731, asOf: "2026-11-03" };

describe.runIf(url)("saving a person's own credit report", () => {
  const people: string[] = [];
  afterAll(async () => removePeople(db, people));
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
  });
  afterEach(() => {
    for (const key of Object.keys(flags.real)) delete flags.real[key];
    vi.unstubAllEnvs();
  });

  async function person() {
    const id = await realPerson(db);
    people.push(id);
    return id;
  }

  it("is refused while off, and for a trial person", async () => {
    const userId = await person();
    await expect(
      saveCreditUpload(userId, { report: REPORT, score: SCORE }, { now: NOW }),
    ).rejects.toMatchObject({ reason: "switched_off" });
    flags.real.credit_upload = true;
    vi.stubEnv("CONNECTORS", "");
    await expect(
      saveCreditUpload(userId, { report: REPORT, score: SCORE }, { now: NOW }),
    ).rejects.toMatchObject({ reason: "off" });
    vi.stubEnv("CONNECTORS", "1");
    const trial = await trialPerson(db);
    people.push(trial);
    await expect(
      saveCreditUpload(trial, { report: REPORT, score: SCORE }, { now: NOW }),
    ).rejects.toMatchObject({ reason: "trial" });
  });

  it("needs the person's read_credit consent, then keeps only derived numbers", async () => {
    flags.real.credit_upload = true;
    const userId = await person();
    await expect(
      saveCreditUpload(userId, { report: REPORT, score: SCORE }, { now: NOW }),
    ).rejects.toMatchObject({ field: "consent" });
    await grantConsent(userId, "credit_upload", ["read_credit"], { now: NOW });
    const { id } = await saveCreditUpload(userId, { report: REPORT, score: SCORE }, { now: NOW });
    const row = await system().creditReport.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      userId,
      partner: "upload",
      score: 731,
      model: "FICO Score 8",
      rangeLow: 300,
      rangeHigh: 850,
      cardLimitCents: 400_000,
      averageAgeMonths: 30,
      hardInquiries: 1,
      demo: false,
    });
    expect(row.pulledOn.toISOString().slice(0, 10)).toBe("2026-11-03");
    expect(JSON.stringify(row.inputs)).not.toContain("Alex");
    const audit = await system().auditLog.count({
      where: { targetId: userId, event: "credit_report_uploaded" },
    });
    expect(audit).toBe(1);
  });
});
