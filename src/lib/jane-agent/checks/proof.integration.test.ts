import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { proveOn } from "./proof";
import { stubTestKeys } from "@/lib/__fixtures__/env";

// Spec step 266 against a real, migrated Postgres: every sample person, met through Try Jane,
// gets their written list's top suggestions in the chat's first message, nothing they must not
// get, tools that answer, and no answer that contradicts a suggestion. `npm run checks:proof`
// writes the same walk to docs/proof-on-every-person.md.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("proof on every person", { timeout: 180_000 }, () => {
  let client: PrismaClient;

  beforeAll(() => {
    stubTestKeys();
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it.each(PEOPLE)("$name: the right suggestions, led with, and a chat that agrees", async (p) => {
    const proof = await proveOn(p, { client, now: NOW });
    expect(proof.problems, proof.problems.join("; ")).toEqual([]);
    expect(proof.offered.length).toBeGreaterThan(0);
    expect(proof.leadsWithSuggestions).toBe(true);
    expect(proof.offered.every((s) => s.onList && !s.mustNot)).toBe(true);
  });
});
