import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Reading a person's own W-2 or 1099: off until the connector's switch and their read_accounts
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
import { W2_SAME_LINE } from "./__fixtures__/forms";
import { readTaxFormUpload } from "./parse";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: reads the audit log", db);

describe.runIf(url)("reading a person's uploaded tax form", () => {
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
    await expect(readTaxFormUpload(userId, W2_SAME_LINE)).rejects.toMatchObject({
      reason: "switched_off",
    });
    flags.real.tax_form_upload = true;
    vi.stubEnv("CONNECTORS", "");
    await expect(readTaxFormUpload(userId, W2_SAME_LINE)).rejects.toMatchObject({
      reason: "off",
    });
    vi.stubEnv("CONNECTORS", "1");
    const trial = await trialPerson(db);
    people.push(trial);
    await expect(readTaxFormUpload(trial, W2_SAME_LINE)).rejects.toMatchObject({
      reason: "trial",
    });
  });

  it("needs consent, then reads it and audits only its kind and how many boxes", async () => {
    flags.real.tax_form_upload = true;
    const userId = await realPerson(db);
    people.push(userId);
    await expect(readTaxFormUpload(userId, W2_SAME_LINE)).rejects.toThrow(/consent/);
    await grantConsent(userId, "tax_form_upload", ["read_accounts"]);
    const form = await readTaxFormUpload(userId, W2_SAME_LINE);
    expect(form.kind).toBe("w2");
    const audit = await system().auditLog.findFirstOrThrow({
      where: { targetId: userId, event: "tax_form_uploaded" },
    });
    expect(audit.metadata).toEqual({ kind: "w2", boxes: 8 });
  });
});
