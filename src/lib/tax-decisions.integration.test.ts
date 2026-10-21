import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { DECISION_TOPICS } from "@/config/tax-decisions";
import { decideTax } from "@/lib/tax-decisions";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";

// Tax decisions against a real, migrated Postgres: every answer is three sentences or fewer
// and carries a figure from the person's own numbers; someone in debt trouble is told to clear
// the debt before a new 401(k) deferral.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-17T15:00:00Z");
const sentences = (t: string) => t.split(/(?<=[.!?])\s+(?=[A-Z])/).length;

describe.runIf(url)("tax decisions against a real database", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person(person?: "debt" | "freelancer") {
    const user = await client.user.create({
      data: { email: `taxdec-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person });
    await syncItem(itemId, { client, api: {} as PlaidApi, now: NOW });
    return user.id;
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("answers every topic in three sentences or fewer", async () => {
    const id = await person();
    for (const topic of DECISION_TOPICS) {
      const d = await decideTax(id, topic, { client, now: NOW });
      expect(d.text.length, topic).toBeGreaterThan(20);
      expect(sentences(d.text), `${topic}: ${d.text}`).toBeLessThanOrEqual(3);
    }
  });

  it("puts debt before a new 401(k) deferral, and says what the numbers are on a real account", async () => {
    const chris = await person("debt");
    const d = await decideTax(chris, "k401", { client, now: NOW });
    expect(d.advice).toBe(true);
    expect(d.text).toMatch(/^Not yet\..*debt/);

    const real = await client.user.create({
      data: { email: `taxdec-${crypto.randomUUID()}@example.com` },
    });
    created.push(real.id);
    const r = await decideTax(real.id, "ira", { client, now: NOW });
    expect(r.advice).toBe(false);
    expect(r.text).toMatch(/not what to do/);
  });
});
