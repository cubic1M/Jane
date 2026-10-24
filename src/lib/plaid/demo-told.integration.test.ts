import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import type { PersonId } from "@/config/people";
import { detectFor } from "@/lib/suggestions";
import { linkDemoBank } from "./demo";
import { syncItem } from "./sync";

// Detector coverage: three detectors fit none of the sample people until their lives had the
// data: Maya's rent rose at renewal, Dan and Lena co-signed Emily's car loan, and Ruth's
// sister's IRA has to be empty this year. Each now reaches them through the demo bank, as in the
// harness: the co-signed loan and the year Ruth told Jane are seeded at the first sync.

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

describe.runIf(url)("what the sample people told Jane, in the demo bank", () => {
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

  async function person(id: PersonId) {
    const user = await client.user.create({
      data: { email: `demo-told-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person: id });
    await syncItem(itemId, { client, api: NO_PLAID, now: NOW });
    return user.id;
  }
  const topics = async (userId: string) =>
    (await detectFor(userId, { client, now: NOW })).suggestions.map((s) => s.topic);

  it.each<[PersonId, string]>([
    ["renter", "rent_increase"],
    ["preretire", "cosign_risk"],
    ["retiree", "inherited_ira"],
  ])("brings %s their %s unasked", { timeout: 120_000 }, async (id, topic) => {
    expect(await topics(await person(id))).toContain(topic);
  });

  it(
    "seeds once, and leaves what the person already told alone",
    { timeout: 120_000 },
    async () => {
      const ruth = await person("retiree");
      const fact = await client.janePreference.findFirst({
        where: { userId: ruth, key: "profile:inherited_ira_death_year" },
      });
      expect(fact?.value).toEqual({ value: 2016 });
      const dan = await person("preretire");
      expect(await client.familyCreditHelp.count({ where: { userId: dan } })).toBe(1);
      // Nobody else co-signed anything.
      const maya = await person("renter");
      expect(await client.familyCreditHelp.count({ where: { userId: maya } })).toBe(0);
    },
  );
});
