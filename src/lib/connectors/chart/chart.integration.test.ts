import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Chart's sandbox twin against a real, migrated Postgres: a sample person who allows it gets their
// transcripts through Chart's shape; a real person gets no transcript partner at all.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});

import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { db } from "@/lib/db";
import { partnerTranscripts, transcriptPartnerFor } from "@/lib/tax-transcripts";
import { realPerson, removePeople, samplePerson } from "../__fixtures__/people";
import { ConsentError, grantConsent } from "../consent";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-18T15:00:00Z");
const network = vi.fn(() => {
  throw new Error("no network in tests");
});

describe.runIf(url)("Chart as the transcript partner, sandbox only", () => {
  const people: string[] = [];
  let sample: string;
  let real: string;

  beforeAll(async () => {
    sample = await samplePerson(db);
    real = await realPerson(db);
    people.push(sample, real);
  });
  afterAll(async () => {
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    vi.stubGlobal("fetch", network);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    expect(network).not.toHaveBeenCalled();
  });

  it("reads a sample person's transcripts through Chart once they allow it", async () => {
    expect((await transcriptPartnerFor(sample, { now: NOW }))?.name).not.toBe("chart (sandbox)");
    await grantConsent(sample, "sandbox_chart_transcripts", ["read_accounts"]);
    expect((await transcriptPartnerFor(sample, { now: NOW }))?.name).toBe("chart (sandbox)");
    const transcripts = await partnerTranscripts(sample, { now: NOW });
    // The finding it feeds: each year's return, withholding and refund, for the refund tracker.
    expect(transcripts!.map((t) => t.taxYear)).toEqual([2025, 2024]);
    expect(transcripts!.every((t) => t.lines.some((l) => l.code === "846"))).toBe(true);
  });

  it("keeps the twin from sample people with connectors off", async () => {
    vi.stubEnv("CONNECTORS", "");
    expect((await transcriptPartnerFor(sample, { now: NOW }))?.name).not.toBe("chart (sandbox)");
  });

  it("gives a real person no transcript partner", async () => {
    await expect(
      grantConsent(real, "sandbox_chart_transcripts", ["read_accounts"]),
    ).rejects.toBeInstanceOf(ConsentError);
    expect(await transcriptPartnerFor(real, { now: NOW })).toBeNull();
  });
});
