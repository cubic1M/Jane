import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import type { PersonId } from "@/config/people";
import { runHarness } from "@/detectors/harness";
import { detectFor } from "@/lib/suggestions";
import { linkDemoBank } from "./demo";
import { syncItem } from "./sync";

// Found in the investing debugging pass: the detector harness said Priya had a values list and
// that most sample people had named beneficiaries, but the demo bank seeded neither. So in the
// app Priya never got the values suggestion, and Maya, Priya and Ruth were told to name
// beneficiaries they had already named. The demo bank now seeds both from the same lists.

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
const TOPICS = ["values_funds", "beneficiaries"];

describe.runIf(url)("a sample person's values and beneficiaries in the demo bank", () => {
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
      data: { email: `demo-investing-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person: id });
    await syncItem(itemId, { client, api: NO_PLAID, now: NOW });
    return user.id;
  }

  it.each<PersonId>(["equity", "renter", "family", "retiree"])(
    "gives %s the same values and beneficiaries suggestions as the harness",
    { timeout: 120_000 },
    async (id) => {
      const userId = await person(id);
      const live = (await detectFor(userId, { client, now: NOW })).suggestions
        .map((s) => s.topic)
        .filter((t) => TOPICS.includes(t));
      const harness = runHarness()
        .find((r) => r.person.id === id)!
        .fired.map((s) => s.topic)
        .filter((t) => TOPICS.includes(t));
      expect(live.sort()).toEqual(harness.sort());
    },
  );

  it("seeds once, and leaves what the person has set", { timeout: 120_000 }, async () => {
    const userId = await person("equity");
    expect(await client.valuesPreference.findUnique({ where: { userId } })).toMatchObject({
      excludes: ["fossil_fuels"],
    });
    const named = await client.accountBeneficiary.count({ where: { userId } });
    expect(named).toBeGreaterThan(0);
    // A second sync adds nothing.
    const item = await client.plaidItem.findFirstOrThrow({ where: { userId } });
    await syncItem(item.id, { client, api: NO_PLAID, now: new Date(NOW.getTime() + 86_400_000) });
    expect(await client.accountBeneficiary.count({ where: { userId } })).toBe(named);
  });
});
