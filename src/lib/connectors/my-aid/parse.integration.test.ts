import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Reading a person's My Aid file: off until the connector's switch and their read_accounts
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
import { MY_AID_FILE } from "./__fixtures__/my-aid";
import { readMyAidUpload } from "./parse";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: reads the audit log", db);

describe.runIf(url)("reading a person's My Aid file", () => {
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
    await expect(readMyAidUpload(userId, MY_AID_FILE)).rejects.toMatchObject({
      reason: "switched_off",
    });
    flags.real.my_aid_upload = true;
    vi.stubEnv("CONNECTORS", "");
    await expect(readMyAidUpload(userId, MY_AID_FILE)).rejects.toMatchObject({ reason: "off" });
    vi.stubEnv("CONNECTORS", "1");
    const trial = await trialPerson(db);
    people.push(trial);
    await expect(readMyAidUpload(trial, MY_AID_FILE)).rejects.toMatchObject({ reason: "trial" });
  });

  it("needs consent, then reads the loans and audits only how many", async () => {
    flags.real.my_aid_upload = true;
    const userId = await realPerson(db);
    people.push(userId);
    await expect(readMyAidUpload(userId, MY_AID_FILE)).rejects.toThrow(/consent/);
    await grantConsent(userId, "my_aid_upload", ["read_accounts"]);
    const loans = await readMyAidUpload(userId, MY_AID_FILE);
    expect(loans.map((l) => l.typeCode)).toEqual(["D1", "D2"]);
    const audit = await system().auditLog.findFirstOrThrow({
      where: { targetId: userId, event: "my_aid_uploaded" },
    });
    expect(audit.metadata).toEqual({ loans: 2 });
  });
});
