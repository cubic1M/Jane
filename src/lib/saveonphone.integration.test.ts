import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { SAVEONPHONE_PLAN } from "@/lib/__fixtures__/saveonphone";
import { usableOptions } from "./compare";
import { stageSaveOnPhonePlans } from "./saveonphone";

// SaveOnPhone's plans staged as options against a real, migrated Postgres: added unreviewed, so Jane
// compares none of them until the team checks it; read again in place; a changed price needs checking
// again.

const url = process.env.TEST_DATABASE_URL;
const SOURCE = `https://saveonphone.com/plans/test-${crypto.randomUUID()}/`;
const plan = (renewalTotal: number) => ({
  ...SAVEONPHONE_PLAN,
  saveonphone_url: SOURCE,
  billing: { ...SAVEONPHONE_PLAN.billing, renewal_total_cents: renewalTotal },
});
const answering = (plans: unknown[]) =>
  vi.fn(async () => Response.json({ status: "ok", plans, next_offset: null }));

describe.runIf(url)("SaveOnPhone's plans as options to check", () => {
  let client: PrismaClient;
  const NOW = new Date("2026-11-19T15:00:00Z");
  const row = () => client.switchOption.findFirstOrThrow({ where: { sourceUrl: SOURCE } });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.switchOption.deleteMany({ where: { sourceUrl: SOURCE } });
    await client.$disconnect();
  });

  it("adds a plan unreviewed, which Jane doesn't compare", async () => {
    expect(
      await stageSaveOnPhonePlans({ client, fetch: answering([plan(24_000)]) as never }),
    ).toEqual({
      added: 1,
      updated: 0,
    });
    expect(await row()).toMatchObject({
      kind: "plan",
      category: "phone",
      provider: "Mint Mobile",
      monthlyCents: 2_000,
      reviewedAt: null,
      demo: false,
    });
    const options = await usableOptions({ client, now: NOW });
    expect(options.find((o) => o.sourceUrl === SOURCE)).toBeUndefined();
  });

  it("updates it in place, keeps a review when nothing changed, and drops it when the price did", async () => {
    await client.switchOption.updateMany({
      where: { sourceUrl: SOURCE },
      data: { reviewedAt: NOW },
    });
    expect(
      await stageSaveOnPhonePlans({ client, fetch: answering([plan(24_000)]) as never }),
    ).toEqual({
      added: 0,
      updated: 1,
    });
    expect((await row()).reviewedAt).not.toBeNull();
    await stageSaveOnPhonePlans({ client, fetch: answering([plan(30_000)]) as never });
    expect(await row()).toMatchObject({ monthlyCents: 2_500, reviewedAt: null });
    expect(await client.switchOption.count({ where: { sourceUrl: SOURCE } })).toBe(1);
  });
});
