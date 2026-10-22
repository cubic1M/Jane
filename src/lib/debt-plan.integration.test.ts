import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { DEMO_ADVICE_LABEL } from "@/config/advice";
import { track } from "@/lib/analytics";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { payoffPlan } from "@/planning/debt";
import { checkPlan, loadPayoff, refreshDebtPlan, startDebtPlan, stopDebtPlan } from "./debt-plan";
import { saveDebtTerms } from "./debts";

// Spec step 110 against a real, migrated Postgres, on the demo bank: the plan across every
// debt with the planner's math, Jane's pick (demo advice, labelled), "Start this plan" from
// the chat, and the monthly check that finds the plan off track or on track and says so.
// A real account gets the math with no pick.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const later = (days: number) => new Date(LINKED.getTime() + days * DAY);

describe.runIf(url)("payoff plans against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;
  const opts = (now = LINKED) => ({ client, now });

  async function person(prefix: string) {
    const user = await client.user.create({
      data: {
        email: `${prefix}-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    created.push(user.id);
    return user.id;
  }

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = await person("payoff-demo");
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("plans every debt but the mortgage with the planner's math, and picks an order", async () => {
    const payoff = await loadPayoff(userId, opts());
    expect(payoff.advice).toBe(true);
    const { summary } = payoff;
    expect(summary.cards.map((c) => c.name).sort()).toEqual([
      "Demo Car Loan ····0006",
      "Demo Credit Card ····0003",
      "Demo Student Loan ····0005",
      "Klarna Pay in 4",
    ]);
    expect(summary.leftOut).toEqual([
      { name: "Affirm plan", reason: "no_balance" },
      { name: "Demo Home Loan ····0004", reason: "mortgage" },
    ]);
    expect(summary.avalanche).toEqual(
      payoffPlan(summary.cards, summary.minimumsCents, "avalanche"),
    );
    expect(summary.pick?.strategy).toBe("avalanche");
    expect(summary.pick?.order[0]).toBe("Demo Credit Card ····0003");
    expect(payoff.debtFreeMonth).toMatch(/^\d{4}-\d{2}$/);
  });

  it("answers the fastest way out of debt as labelled demo advice, and Start saves the plan", async () => {
    const { reply } = await sendToJane(userId, "What's the fastest way out of debt?", opts());
    expect(reply.body).toMatch(
      /^Here's how I'd pay them off: highest rate first\.\n1\. Demo Credit Card ····0003/,
    );
    expect(reply.body).toContain(
      "Not included: Affirm plan (no balance yet), Demo Home Loan ····0004 (it runs on its own schedule).",
    );
    expect(reply.refs).toMatchObject({ advice: true, debtPlanExtraCents: 0 });
    expect(reply.actions.map((a) => a.label)).toEqual([
      "Start this plan",
      "Use smallest balance first",
      "Open the payoff planner",
    ]);
    const tapped = await takeChatAction(userId, reply.id, "debt_plan.avalanche", opts());
    expect(tapped.message.refs.note).toMatch(
      /^Started, debt-free by \w+ \d{4}\. I'll check it every month/,
    );
    const row = await client.debtPlan.findUniqueOrThrow({ where: { userId } });
    expect(row).toMatchObject({ strategy: "avalanche", extraCents: 0, status: null });
    expect((row.expected as number[]).length).toBeGreaterThan(0);
    expect(track).toHaveBeenCalledWith(userId, "debt_plan_started", {
      strategy: "avalanche",
      extra: false,
    });

    // Asked again, it's their plan: no Start buttons.
    const again = await sendToJane(userId, "show me my payoff plan", opts(later(0.001)));
    expect(again.reply.body).toContain(
      "This is your plan (highest rate first). I check it every month.",
    );
    expect(again.reply.actions.map((a) => a.id)).toEqual(["open"]);
  });

  it("works out 'what if I pay $200 more' and offers to start it with that extra", async () => {
    const { reply } = await sendToJane(
      userId,
      "what if I pay $200 more a month",
      opts(later(0.002)),
    );
    expect(reply.body).toContain("Paying ");
    expect(reply.body).toContain("plus $200.00 extra");
    expect(reply.refs.debtPlanExtraCents).toBe(20_000);
    expect(reply.actions[0]).toMatchObject({ id: "debt_plan.avalanche", label: "Start this plan" });
  });

  it("checks itself a month later: off track when nothing was paid down, and says so", async () => {
    expect(await refreshDebtPlan(userId, opts(later(10)))).toBeNull();
    // The demo bank wasn't synced again, so the balances haven't gone down.
    const check = await refreshDebtPlan(userId, opts(later(31)));
    expect(check).toMatchObject({ status: "off_track" });
    expect(check!.actualCents).toBeGreaterThan(check!.expectedCents);

    const snapshot = await loadSnapshot(userId, opts(later(31)));
    const [message] = gather(snapshot!, later(31), { trigger: "sync" }).filter(
      (m) => m.source === "payoff",
    );
    expect(message).toMatchObject({ kind: "heads_up", dedupeKey: "payoff:check:2026-11-18" });
    expect(message.body).toMatch(
      /^Your payoff plan is off track: your debts add up to \$[\d,.]+, and the plan expected \$[\d,.]+ by now/,
    );
  });

  it("is on track once the balances come down as planned, posted by Jane's own run", async () => {
    const row = await client.debtPlan.findUniqueOrThrow({ where: { userId } });
    const target = (row.expected as number[])[1];
    // Pay the card down so the plan's debts add up to less than expected.
    const card = await client.account.findFirstOrThrow({ where: { userId, type: "credit" } });
    const book = (await loadPayoff(userId, opts(later(31)))).summary;
    const owed = book.cards.reduce((sum, c) => sum + c.balanceCents, 0);
    await client.account.update({
      where: { id: card.id },
      data: { currentBalanceCents: (card.currentBalanceCents ?? 0) - (owed - target) - 50_000 },
    });

    // Jane's own run checks the plan before it looks at the person's money.
    await runJaneAgent(userId, { client, now: later(62), trigger: "open" });
    expect((await client.debtPlan.findUniqueOrThrow({ where: { userId } })).status).toBe(
      "on_track",
    );
    const snapshot = await loadSnapshot(userId, opts(later(62)));
    const [message] = gather(snapshot!, later(62), { trigger: "open" }).filter(
      (m) => m.source === "payoff",
    );
    expect(message).toMatchObject({ kind: "done", dedupeKey: "payoff:check:2026-12-19" });
    expect(message.body).toMatch(/^I checked your payoff plan: you're on track/);
  });

  it("gives Claude the plan, with every figure recorded", async () => {
    const tool = await runChatTool(userId, "payoff_plan", { extra_dollars: 100 }, opts(later(62)));
    const output = JSON.parse(tool.content);
    expect(output.extraAMonth).toBe("$100.00");
    expect(output.janesPick.strategy).toBe("avalanche");
    expect(output.startedPlan.lastCheck.status).toBe("on_track");
    expect(tool.cents).toContain(10_000);
  });

  it("stops the plan", async () => {
    await stopDebtPlan(userId, opts());
    expect(await client.debtPlan.count({ where: { userId } })).toBe(0);
  });

  it("gives a real account the math with no pick and no label", async () => {
    const realId = await person("payoff-real");
    const card = await client.account.create({
      data: {
        userId: realId,
        source: "csv",
        name: "Store Card",
        type: "credit",
        subtype: "credit card",
        currentBalanceCents: 120_000,
      },
    });
    await saveDebtTerms(
      realId,
      { debtKey: `account:${card.id}`, apr: "24.99", minimum: "60", balance: "", payoffDate: "" },
      opts(),
    );
    const payoff = await loadPayoff(realId, opts());
    expect(payoff.advice).toBe(false);
    expect(payoff.summary.pick).toBeNull();
    const { reply } = await sendToJane(realId, "how do I pay off my debt", opts());
    expect(reply.body).toContain("here's how two common orders would go");
    expect(reply.body).toContain("This is math, not a recommendation.");
    expect(reply.body).not.toContain(DEMO_ADVICE_LABEL);
    expect(reply.refs.advice).toBeUndefined();
    expect(reply.actions.map((a) => a.label)).toEqual([
      "Track highest rate first",
      "Track smallest balance first",
      "Open the payoff planner",
    ]);
    await expect(
      startDebtPlan(realId, { strategy: "sideways", extraCents: 0 }, opts()),
    ).rejects.toThrow("Pick an order to pay them in.");
  });
});

describe("the monthly check", () => {
  it("is off track when less than half the planned paydown happened", () => {
    // Owed $100,000 at the last check; the plan pays $4,000 down a month.
    const expected = [10_000_000, 9_600_000, 9_200_000, 8_800_000];
    expect(checkPlan(expected, 1, 9_750_000)).toEqual({
      status: "on_track",
      expectedCents: 9_600_000,
      actualCents: 9_750_000,
    });
    expect(checkPlan(expected, 1, 9_800_001)?.status).toBe("off_track");
    // Two months since the last check: compared with the second month.
    expect(checkPlan(expected, 2, 9_500_000)?.status).toBe("on_track");
    expect(checkPlan(expected, 2, 9_700_000)?.status).toBe("off_track");
    // Past the months kept: the last one.
    expect(checkPlan(expected, 9, 8_800_000)?.expectedCents).toBe(8_800_000);
    // A small plan still allows the minimum before it's off track.
    expect(checkPlan([100_000, 99_000], 1, 105_000)?.status).toBe("on_track");
    expect(checkPlan([100_000], 1, 1)).toBeNull();
  });
});
