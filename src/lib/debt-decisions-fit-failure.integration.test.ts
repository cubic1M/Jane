import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/fit", () => ({
  loadFit: vi.fn(async () => {
    throw new Error("lender prequalify rejected");
  }),
}));

import { loadDecisionInput } from "./debt-decisions";

// CodeRabbit sweep 1c (lib-01): a lender's check failing costs the consolidation offer only; the
// other debt decisions still load.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)(
  "debt decisions when the consolidation check fails",
  { timeout: 60_000 },
  () => {
    let client: PrismaClient;
    let userId = "";
    beforeAll(async () => {
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      userId = (
        await client.user.create({ data: { email: `fit-fail-${crypto.randomUUID()}@example.com` } })
      ).id;
    });
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: userId } });
      await client.$disconnect();
    });

    it("loads with no consolidation offer instead of rejecting", async () => {
      const input = await loadDecisionInput(userId, { client });
      expect(input.consolidation).toBeNull();
      expect(input.personalLoan).toBeNull();
      expect(input.cashPayoffSavesCents).toBeNull();
    });
  },
);
