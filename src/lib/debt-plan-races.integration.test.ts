import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

// While the balances load: where a test says the person restarts or stops the plan.
const hooks: { whileLoading: (() => Promise<void>) | null } = { whileLoading: null };
vi.mock("@/lib/debts", async (original) => {
  const real = await original<typeof import("@/lib/debts")>();
  return {
    ...real,
    loadDebts: async (...args: Parameters<typeof real.loadDebts>) => {
      const book = await real.loadDebts(...args);
      await hooks.whileLoading?.();
      return book;
    },
  };
});

import { track } from "@/lib/analytics";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { NO_PLAID as plaid } from "@/lib/__fixtures__/plaid";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { refreshDebtPlan, startDebtPlan } from "./debt-plan";

// CodeRabbit sweep 1c (lib-01): the monthly check writes only the plan it read, and a failed
// analytics row doesn't hide a plan that was saved or a check that was recorded.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const LATER = new Date("2026-11-20T15:00:00Z");

describe.runIf(url)("the debt plan under races and failed analytics", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId = "";
  const opts = (now = LINKED) => ({ client, now });
  const plan = () => client.debtPlan.findFirst({ where: { userId } });
  // Each test that needs a saved plan makes it itself, so a single test can be run alone.
  const ensurePlan = async () => {
    if (!(await plan())) {
      await startDebtPlan(userId, { strategy: "avalanche", extraCents: 0 }, opts());
    }
  };

  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: { email: `debt-plan-races-${crypto.randomUUID()}@example.com` },
      })
    ).id;
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("returns the saved plan when the analytics row fails", async () => {
    vi.mocked(track).mockRejectedValueOnce(new Error("analytics down"));
    const started = await startDebtPlan(userId, { strategy: "avalanche", extraCents: 0 }, opts());
    expect(started.strategy).toBe("avalanche");
    expect((await plan())?.strategy).toBe("avalanche");
  });

  it("returns the recorded check when the analytics row fails", async () => {
    await ensurePlan();
    vi.mocked(track).mockRejectedValueOnce(new Error("analytics down"));
    const check = await refreshDebtPlan(userId, opts(LATER));
    expect(check).not.toBeNull();
    expect((await plan())?.checkedOn.toISOString().slice(0, 10)).toBe("2026-11-20");
  });

  it("does not write an old strategy's schedule over a plan restarted meanwhile", async () => {
    await ensurePlan();
    await client.debtPlan.update({
      where: { userId },
      data: { checkedOn: new Date("2026-10-18T00:00:00Z") },
    });
    hooks.whileLoading = async () => {
      hooks.whileLoading = null;
      await client.debtPlan.update({
        where: { userId },
        data: { strategy: "snowball", expected: [1, 1, 1] },
      });
    };
    expect(await refreshDebtPlan(userId, opts(LATER))).toBeNull();
    const row = await plan();
    expect(row?.strategy).toBe("snowball");
    expect(row?.expected).toEqual([1, 1, 1]);
  });

  it("reports no check for a plan stopped meanwhile", async () => {
    await ensurePlan();
    await client.debtPlan.update({
      where: { userId },
      data: { checkedOn: new Date("2026-10-18T00:00:00Z"), expected: [100_000, 90_000, 80_000] },
    });
    hooks.whileLoading = async () => {
      hooks.whileLoading = null;
      await client.debtPlan.delete({ where: { userId } });
    };
    expect(await refreshDebtPlan(userId, opts(LATER))).toBeNull();
    expect(await plan()).toBeNull();
  });
});
