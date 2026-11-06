import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { createCheckPerson, deleteCheckPerson } from "@/lib/jane-agent/checks/person";
import { loadTaxEstimate } from "./tax-estimate";

// Night round 11-06, the retiree sample person at 3pm and 7pm in Los Angeles: the year's
// itemized deductions read "charity $160, medical costs over the floor $18,931" at 3pm and
// "$161, $18,949" at 7pm, when UTC is already tomorrow. The year so far ends on the person's day.
const url = process.env.TEST_DATABASE_URL;
const AFTERNOON = new Date("2026-11-05T23:00:00Z");
const EVENING = new Date("2026-11-06T03:00:00Z");

describe.runIf(url)("the tax estimate across the evening", { timeout: 180_000 }, () => {
  let client: PrismaClient;
  let id: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    id = await createCheckPerson({ client, now: AFTERNOON, person: "retiree" });
  });

  afterAll(async () => {
    await deleteCheckPerson(id, { client }).catch(() => {});
    await client.$disconnect();
  });

  it("is the same at 3pm and 7pm in the person's own day", async () => {
    const afternoon = await loadTaxEstimate(id, { client, now: AFTERNOON });
    const evening = await loadTaxEstimate(id, { client, now: EVENING });
    expect(JSON.stringify(evening)).toBe(JSON.stringify(afternoon));
  });
});
