import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { CHECKING, input, tx } from "@/detection/__fixtures__/build";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

// After the plans are read: where a test says the person answers, before the check writes.
const hooks: { afterPlansRead: (() => Promise<void>) | null } = { afterPlansRead: null };
vi.mock("@/lib/db-scoped", async (original) => {
  const real = await original<typeof import("@/lib/db-scoped")>();
  return {
    ...real,
    scopedFor: (...args: Parameters<typeof real.scopedFor>) => {
      const scoped = real.scopedFor(...args);
      return {
        ...scoped,
        leanPlans: {
          ...scoped.leanPlans,
          findMany: async (...a: Parameters<typeof scoped.leanPlans.findMany>) => {
            const rows = await scoped.leanPlans.findMany(...a);
            await hooks.afterPlansRead?.();
            return rows;
          },
        },
      };
    },
  };
});

import { logAudit } from "@/lib/audit";
import { track } from "@/lib/analytics";
import { runLeanCheck, startLean } from "./lean-plan";

// CodeRabbit sweep 1c (lib-02): a pay-is-back check doesn't overwrite a plan the person just
// said yes to, and a start whose audit or analytics write failed can be recovered.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-16T15:00:00Z");

describe.runIf(url)("the lean plan under races and failed writes", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId = "";

  const proposal = (changeKey: string) =>
    client.leanPlan.create({
      data: { userId, changeKey, employer: "Acme", dueOn: "2026-10-01", status: "proposed" },
    });
  const statusOf = async (id: string) =>
    (await client.leanPlan.findUniqueOrThrow({ where: { id } })).status;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `lean-races-${crypto.randomUUID()}@example.com` } })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("does not decline a proposal that was accepted after the check read it", async () => {
    const plan = await proposal("late:race");
    const pay = ["2026-09-04", "2026-09-18", "2026-10-02", "2026-10-16"].map((date) =>
      tx({
        date,
        amountCents: -250_000,
        description: "ACME PAYROLL",
        pfcPrimary: "INCOME",
        pfcDetailed: "INCOME_WAGES",
      }),
    );
    const data = input({ accounts: [CHECKING], transactions: pay });
    hooks.afterPlansRead = async () => {
      hooks.afterPlansRead = null;
      await client.leanPlan.update({
        where: { id: plan.id },
        data: { status: "active", startedAt: NOW },
      });
    };
    const out = await runLeanCheck(userId, { client, now: NOW, input: data });
    expect(out.ended).toBe(0);
    expect(await statusOf(plan.id)).toBe("active");
  });

  it("asks again when the start's audit row could not be written", async () => {
    const plan = await proposal("late:audit");
    vi.mocked(logAudit).mockRejectedValueOnce(new Error("audit down"));
    await expect(startLean(userId, plan.id, { client, now: NOW })).rejects.toThrow("audit down");
    expect(await statusOf(plan.id)).toBe("proposed");
    await startLean(userId, plan.id, { client, now: NOW });
    expect(await statusOf(plan.id)).toBe("active");
  });

  it("still starts when only the analytics write failed", async () => {
    const plan = await proposal("late:analytics");
    vi.mocked(track).mockRejectedValueOnce(new Error("analytics down"));
    await expect(startLean(userId, plan.id, { client, now: NOW })).resolves.toBeUndefined();
    expect(await statusOf(plan.id)).toBe("active");
  });
});
