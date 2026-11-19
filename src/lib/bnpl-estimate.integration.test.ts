import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
// Checking as a statement shows it (`startCents`) and walked forward to today (`todayCents`):
// set per test, over the real forecast.
const walk = vi.hoisted(() => ({ statement: 0, today: 0, on: "" }));
vi.mock("@/detection/forecast", async (actual) => {
  const real = await actual<typeof import("@/detection/forecast")>();
  return {
    ...real,
    forecastAccounts: (...args: Parameters<typeof real.forecastAccounts>) =>
      real
        .forecastAccounts(...args)
        .map((f) =>
          walk.on
            ? { ...f, startCents: walk.statement, todayCents: walk.today, startOn: walk.on }
            : f,
        ),
  };
});

import { PAYOFF_CUSHION_CENTS } from "@/config/bnpl";
import { NO_PLAID as plaid } from "@/lib/__fixtures__/plaid";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { bnplReply } from "@/lib/jane-agent/bnpl-replies";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadBnpl } from "./bnpl";

// A decision is made on what the bank or statement shows, never on an estimate (the manager,
// 11-19; debug 3). The pay-later page's "checking can cover the payoff" read checking walked
// forward to today, pay Jane expects but hasn't seen included. With a statement balance that
// doesn't cover a Pay in 4 payoff and its cushion, but would with the pay expected since, it isn't
// offered; the estimate is said as a fact, labelled, instead.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)(
  "paying off a plan, from a balance walked forward",
  { timeout: 120_000 },
  () => {
    let client: PrismaClient;
    let userId: string;
    const klarnaCents = async () => {
      walk.on = "";
      const data = await loadBnpl(userId, { client, now: LINKED });
      return data.plans.find((p) => p.name.startsWith("Klarna"))!.balanceCents!;
    };

    beforeAll(async () => {
      stubTestKeys();
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      userId = (
        await client.user.create({
          data: { email: `bnpl-estimate-${crypto.randomUUID()}@example.com` },
        })
      ).id;
      const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
      await syncItem(itemId, { client, api: plaid, now: LINKED });
    });
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: userId } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    it("isn't offered when only the estimate covers it, and says the estimate as a fact", async () => {
      // The Oct 15 statement: a cent short of the payoff and its cushion. Walked to today with the
      // pay expected since: $1,000 more, which would cover it.
      const owed = await klarnaCents();
      walk.on = "2026-10-15";
      walk.statement = owed + PAYOFF_CUSHION_CENTS - 1;
      walk.today = walk.statement + 100_000;

      const data = await loadBnpl(userId, { client, now: LINKED });
      const plan = data.plans.find((p) => p.name.startsWith("Klarna"))!;
      expect(plan.freePayoff).toBe(true);
      expect(plan.canCoverPayoff).toBe(false);
      const { body } = bnplReply(data, true);
      expect(body).not.toMatch(/costs nothing extra/);
      expect(body).toMatch(
        /checking today is \$[\d,]+\.\d{2}, estimated \(\+\$1,000 of pay and bills expected since your Oct 15 statement\)/,
      );
    });

    it("is offered when the statement itself covers it, whatever the estimate", async () => {
      const owed = await klarnaCents();
      walk.on = "2026-10-15";
      walk.statement = owed + PAYOFF_CUSHION_CENTS;
      walk.today = walk.statement - 100_000;
      const data = await loadBnpl(userId, { client, now: LINKED });
      expect(data.plans.find((p) => p.name.startsWith("Klarna"))!.canCoverPayoff).toBe(true);
    });
  },
);
