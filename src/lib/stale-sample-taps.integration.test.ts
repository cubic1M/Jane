import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoCrypto } from "@/lib/crypto/crypto";
import { actingPartnerFor } from "@/lib/insurance/partner";
import { linkDemoStockPlan } from "@/lib/investments/company-stock";
import { linkDemoHsa } from "@/lib/investments/hsa";
import { rentReportOn } from "@/lib/jane-agent/actions/renting";
import { taxPropertyTeam } from "@/lib/jane-agent/actions/tax-property";

// A read of every chat button: a tab left open, then a real bank linked on another device. Taps on
// what it still shows added sample coins, HSA money and 120 Acme shares to a real person's totals,
// said their rent was being reported, or said a team was filing an appeal.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-04T15:00:00Z");

describe.runIf(url)("taps from a demo-bank person who now has real data", () => {
  let client: PrismaClient;
  const people: string[] = [];

  const person = async (extras: { real?: boolean; doc?: boolean } = {}) => {
    const { id } = await client.user.create({
      data: { email: `stale-${crypto.randomUUID()}@example.com` },
    });
    people.push(id);
    await client.plaidItem.create({
      data: {
        userId: id,
        plaidItemId: `demo-${crypto.randomUUID()}`,
        accessTokenEncrypted: "v1:unused",
      },
    });
    if (extras.real) {
      await client.account.create({
        data: { userId: id, source: "csv", name: "Real checking", type: "depository" },
      });
    }
    if (extras.doc) {
      await client.document.create({
        data: {
          userId: id,
          kind: "insurance_policy",
          fileName: "my-policy.pdf",
          contentType: "application/pdf",
          sizeBytes: 1,
          encryptedBytes: Buffer.from("x"),
          uploadedAt: NOW,
        },
      });
    }
    return id;
  };
  const tap = (handler: typeof rentReportOn, userId: string) =>
    handler.run({ userId, client, now: NOW, action: { label: "Yes" } } as never);

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: people } } });
    await client.$disconnect();
  });

  it("add no sample assets", async () => {
    const id = await person({ real: true });
    await expect(linkDemoCrypto(id, "exchange", { client, now: NOW })).rejects.toThrow(/demo bank/);
    await expect(linkDemoHsa(id, { client, now: NOW })).rejects.toThrow(/demo bank/);
    await expect(linkDemoStockPlan(id, { client, now: NOW })).rejects.toThrow(/demo bank/);
    expect(await client.equityGrant.count({ where: { userId: id } })).toBe(0);
    expect(await client.cryptoConnection.count({ where: { userId: id } })).toBe(0);
  });

  it("promise no reporting and no team", async () => {
    const id = await person({ real: true });
    await expect(tap(rentReportOn, id)).rejects.toThrow(/isn't available/);
    await expect(tap(taxPropertyTeam, id)).rejects.toThrow(/can't file this/);
  });

  it("don't let the stand-in insurer act beside a real document", async () => {
    expect(await actingPartnerFor(await person({ doc: true }), { client })).toBeNull();
    expect(await actingPartnerFor(await person(), { client })).not.toBeNull();
  });
});
