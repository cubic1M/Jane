import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadSideIncome } from "@/lib/side-income";
import { loadHealthTaxes } from "@/lib/health-taxes";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";

// Taxes QA (2026-10-22): Sam, who lives on his freelance income, was asked whether it's a hobby
// ("it's a hobby that costs less"); and in the app Priya's HSA deposits were never seen (a bank's
// transactions don't include an investment account's), so her over-the-limit check never came.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)(
  "side income and HSA deposits, against a real database",
  { timeout: 180_000 },
  () => {
    let client: PrismaClient;
    const created: string[] = [];
    const plaid = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error("no plaid");
        },
      },
    ) as PlaidApi;
    async function person(id: "freelancer" | "equity") {
      const user = await client.user.create({
        data: { email: `qa-${id}-${crypto.randomUUID()}@example.com` },
      });
      created.push(user.id);
      const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person: id });
      await syncItem(itemId, { client, api: plaid, now: NOW });
      return user.id;
    }
    const keys = async (userId: string) =>
      taxesSource
        .gather((await loadSnapshot(userId, { client, now: NOW }))!, {
          now: NOW,
          local: { date: "2026-10-18", hour: 9 },
          trigger: "open",
        })
        .map((c) => c.dedupeKey);

    beforeAll(() => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("PLAID_CLIENT_ID", "");
      vi.stubEnv("PLAID_SECRET", "");
      vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    });
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: { in: created } } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    it("never asks a full-time freelancer whether it's a hobby", async () => {
      const userId = await person("freelancer");
      expect((await loadSideIncome(userId, { client, now: NOW })).bothWays).toBeNull();
      expect((await keys(userId)).some((k) => k.startsWith("sidekind:"))).toBe(false);
    });

    it("sees Priya's HSA deposits and brings up the excess", async () => {
      const userId = await person("equity");
      const h = await loadHealthTaxes(userId, { client, now: NOW });
      expect(h.hsa).toMatchObject({ contributedCents: 500_000, excessCents: 60_000 });
      expect(await keys(userId)).toContain("hsa_excess:2026");
    });
  },
);
