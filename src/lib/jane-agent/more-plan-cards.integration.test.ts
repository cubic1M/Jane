import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { Bnpl } from "@/lib/bnpl";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/advice-mode", async (actual) => ({
  ...(await actual<typeof import("@/lib/advice-mode")>()),
  adviceMode: vi.fn(async () => true),
}));
// The person's Pay in 4 plans as they are today, set by the test.
const today = vi.hoisted(() => ({ bnpl: null as Bnpl | null }));
vi.mock("@/lib/bnpl", async (actual) => ({
  ...(await actual<typeof import("@/lib/bnpl")>()),
  loadBnpl: vi.fn(async () => today.bnpl),
}));

import { formatCents } from "@/lib/money";
import { BNPL_PAGE, payoffButton } from "./bnpl-replies";
import { loadPopupStack } from "./popup-stack";
import { setupBody } from "./sources/setup";
import { snoozeButton } from "./sources/source";

// The manager after gate C (11-23): a set-up budget posted again for each new amount, and a Pay in
// 4 plan's payoff card for each new balance, stayed open beside the newer ones. The dock keeps the
// newest of each, said as it is now, and puts the rest away.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-23T20:00:00Z");
const budget = (amountCents: number) => ({
  kind: "budget" as const,
  key: "budget:Food and drink",
  category: "Food and drink",
  amountCents,
  months: 3,
});
// The payoff card as the source posts it (./sources/bnpl.ts), for a balance.
const payoff = (balanceCents: number) => ({
  kind: "decision" as const,
  body: `You can pay off the Klarna Pay in 4 now for ${formatCents(balanceCents)}, and it costs nothing extra: Pay in 4 plans charge no interest or fee for paying early. That clears its remaining installments and leaves checking above its cushion.`,
  refs: { advice: true, bnplPlan: { key: "klarna-1" } },
  actions: [payoffButton("Klarna Pay in 4"), BNPL_PAGE, snoozeButton()],
});

describe.runIf(url)("one set-up card a budget, one payoff card a plan", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `more-cards-${crypto.randomUUID()}@example.com` } })
    ).id;
    await client.planProposal.create({
      data: { userId, key: "budget:Food and drink", kind: "budget", payload: budget(52_000) },
    });
    for (const [i, cents] of [50_000, 51_000].entries())
      await client.janeMessage.create({
        data: {
          userId,
          kind: "decision",
          body: setupBody(budget(cents)),
          refs: { proposalKey: "budget:Food and drink" },
          actions: [{ id: "setup.yes", label: "Set it up", kind: "primary" }],
          dedupeKey: `setup:budget:Food and drink:${cents}`,
          createdAt: new Date(`2026-11-2${i}T16:00:00Z`),
        },
      });
    for (const [i, cents] of [12_000, 9_000].entries())
      await client.janeMessage.create({
        data: {
          userId,
          ...payoff(cents),
          dedupeKey: `bnpl:bnpl_payoff:klarna-1:${cents}`,
          createdAt: new Date(`2026-11-2${i}T16:00:01Z`),
        },
      });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("shows the newest of each, as it is now, and puts the older away", async () => {
    today.bnpl = {
      available: true,
      asOf: "2026-11-23",
      plans: [
        {
          key: "klarna-1",
          name: "Klarna Pay in 4",
          freePayoff: true,
          canCoverPayoff: true,
          payoffScheduled: false,
          balanceCents: 6_000,
        },
      ],
      installments: [],
      missing: [],
      checkingCents: 200_000,
      forecastDays: [],
    } as unknown as Bnpl;
    const shown = (await loadPopupStack(userId, { client, now: NOW })).map((m) => m.body);
    // The proposal says $520.00 now; the payoff, $60.00.
    expect(shown.filter((b) => b.includes("monthly budget for Food and drink"))).toEqual([
      setupBody(budget(52_000)),
    ]);
    expect(shown.filter((b) => b.startsWith("You can pay off the Klarna"))).toEqual([
      payoff(6_000).body,
    ]);
    const open = await client.janeMessage.count({ where: { userId, status: "open" } });
    expect(open).toBe(2);
  });
});
