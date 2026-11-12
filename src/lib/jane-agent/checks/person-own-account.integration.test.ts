import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { adviceMode } from "@/lib/advice-mode";
import { createCheckPerson, deleteCheckPerson } from "./person";

// The live scenario run's real-account person (scenarios.ts, account "real"): the demo bank plus
// an account of its own, so advice mode is off, as for someone with a real bank.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("a check person with an account of their own", () => {
  let client: PrismaClient;
  const made: string[] = [];
  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    for (const id of made) await deleteCheckPerson(id, { client });
    await client.$disconnect();
  });

  it("is a real account: advice mode is off", async () => {
    const now = new Date("2026-11-12T18:00:00Z");
    const own = await createCheckPerson({ client, now, person: "renter", ownAccount: true });
    const demo = await createCheckPerson({ client, now, person: "renter" });
    made.push(own, demo);
    expect(await adviceMode(own, { client })).toBe(false);
    expect(await adviceMode(demo, { client })).toBe(true);
  }, 120_000);
});
