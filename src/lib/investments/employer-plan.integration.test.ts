import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import type { PersonId } from "@/config/people";
import { runHarness } from "@/detectors/harness";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { detectFor } from "@/lib/suggestions";
import { employerPlanFor } from "./employer-plan";
import { loadMatchPace } from "./match-pace";

// Found in the investing debugging pass: the demo employer's plan (the original demo bank's
// paycheck and match) was given to the sample people too. Their demo data has no 401(k)
// contributions, so every salaried one read as putting in 0% and was told to get their match,
// against their written lives. Only the original demo bank's person has the plan.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const NO_PLAID = new Proxy(
  {},
  {
    get: () => () => {
      throw new Error("no Plaid");
    },
  },
) as never;

describe.runIf(url)("the demo employer plan", () => {
  let client: PrismaClient;
  const created: string[] = [];
  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  async function linked(person?: PersonId) {
    const user = await client.user.create({
      data: { email: `employer-plan-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person });
    await syncItem(itemId, { client, api: NO_PLAID, now: NOW });
    return user.id;
  }

  it(
    "is the original demo bank's person's, with their contributions' pace",
    { timeout: 120_000 },
    async () => {
      const userId = await linked();
      expect(await employerPlanFor(userId, client)).not.toBeNull();
      const pace = await loadMatchPace(userId, { client, now: NOW });
      expect(pace!.employeeRate).toBeGreaterThan(0);
    },
  );

  it.each<PersonId>(["family", "equity", "renter"])(
    "isn't %s's: no plan, and the match suggestion is the harness's",
    { timeout: 120_000 },
    async (id) => {
      const userId = await linked(id);
      expect(await employerPlanFor(userId, client)).toBeNull();
      expect(await loadMatchPace(userId, { client, now: NOW })).toBeNull();
      const live = (await detectFor(userId, { client, now: NOW })).suggestions.some(
        (s) => s.topic === "employer_match",
      );
      const harness = runHarness()
        .find((r) => r.person.id === id)!
        .fired.some((s) => s.topic === "employer_match");
      expect(live).toBe(harness);
    },
  );
});
