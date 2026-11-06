import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Reading a person's IRS account transcript: off until the connector's switch and their read_accounts
// consent, never for a trial person, and audited without anything from the file.

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
import { TRANSCRIPT_TEXT } from "./__fixtures__/transcript";
import { readTranscriptUpload } from "./parse";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: reads the audit log", db);

describe.runIf(url)("reading a person's IRS transcript", () => {
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

  it("is refused while switched off, off, and for a trial person", async () => {
    const userId = await realPerson(db);
    people.push(userId);
    await expect(readTranscriptUpload(userId, TRANSCRIPT_TEXT)).rejects.toMatchObject({
      reason: "switched_off",
    });
    flags.real.irs_transcript_upload = true;
    vi.stubEnv("CONNECTORS", "");
    await expect(readTranscriptUpload(userId, TRANSCRIPT_TEXT)).rejects.toMatchObject({
      reason: "off",
    });
    vi.stubEnv("CONNECTORS", "1");
    const trial = await trialPerson(db);
    people.push(trial);
    await expect(readTranscriptUpload(trial, TRANSCRIPT_TEXT)).rejects.toMatchObject({
      reason: "trial",
    });
  });

  it("needs consent, then reads it and audits only the year and how many lines", async () => {
    flags.real.irs_transcript_upload = true;
    const userId = await realPerson(db);
    people.push(userId);
    await expect(readTranscriptUpload(userId, TRANSCRIPT_TEXT)).rejects.toThrow(/consent/);
    await grantConsent(userId, "irs_transcript_upload", ["read_accounts"]);
    const transcript = await readTranscriptUpload(userId, TRANSCRIPT_TEXT);
    expect(transcript.taxYear).toBe(2025);
    const audit = await system().auditLog.findFirstOrThrow({
      where: { targetId: userId, event: "irs_transcript_uploaded" },
    });
    expect(audit.metadata).toEqual({ taxYear: 2025, lines: 6 });
  });
});
