import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadDebtAutopilot, runDebtAutopilot } from "./debt-autopilot";

// Spec step 117 against a real, migrated Postgres, on the demo bank: Jane watches every rate
// the bank reports and says when one changes, drafts the request to move the student loan's
// payment (due on the 28th, just before the 1st's payday), starts the payoff plan by herself
// only when the debt autopilot does the safe stuff, and answers what she does and what's due.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("debt on autopilot against a real database", () => {
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
  const fromSource = async () => {
    const snapshot = await loadSnapshot(userId, opts());
    return gather(snapshot!, LINKED, { trigger: "sync" }).filter(
      (m) => m.source === "debt_autopilot",
    );
  };

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `dap-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    created.push(userId);
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("asks first: no plan started while the debt autopilot always asks", async () => {
    await runDebtAutopilot(userId, opts());
    expect(await client.debtPlan.count({ where: { userId } })).toBe(0);
    const data = await loadDebtAutopilot(userId, opts());
    expect(data.level).toBe("ask");
    // Every step that adds to the list, in order (steps 109–117, then Phase AG's).
    const steps = data.does.map((d) => d.step);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(steps.slice(0, 9)).toEqual([109, 110, 111, 112, 113, 114, 115, 116, 117]);
    expect(steps).toContain(175);
  });

  it("drafts the request to move a payment due just before payday", async () => {
    const data = await loadDebtAutopilot(userId, opts());
    expect(data.dueMoves.map((m) => [m.debtName, m.dueDay, m.payday, m.suggestedDay])).toEqual([
      ["Demo Student Loan ····0005", 28, 1, 4],
    ]);
    const [move] = (await fromSource()).filter((m) => m.dedupeKey.includes("due-move"));
    expect(move.body).toContain("Here's the request, ready to send:");
    expect(move.body).toContain("from the 28th to the 4th of each month");
  });

  it("says when the bank changes a rate, once", async () => {
    const car = await client.account.findFirstOrThrow({ where: { userId, subtype: "auto" } });
    await client.liability.update({ where: { accountId: car.id }, data: { aprBps: 715 } });
    const { changes } = await runDebtAutopilot(userId, opts());
    expect(changes).toEqual([
      {
        debtKey: `account:${car.id}`,
        name: "Demo Car Loan ····0006",
        fromBps: 690,
        toBps: 715,
        on: "2026-10-18",
      },
    ]);
    expect((await runDebtAutopilot(userId, opts())).changes).toEqual([]);
    const [rate] = (await fromSource()).filter((m) => m.dedupeKey.includes("rate:"));
    expect(rate.body).toMatch(
      /^Your Demo Car Loan ····0006 rate went up from 6\.90% to 7\.15%, as your bank reports it\./,
    );
  });

  it("starts the payoff plan by herself when the debt autopilot does the safe stuff", async () => {
    await client.user.update({ where: { id: userId }, data: { autopilot: "safe" } });
    const { planStarted } = await runDebtAutopilot(userId, opts());
    expect(planStarted).toBe(true);
    expect(await client.debtPlan.count({ where: { userId } })).toBe(1);
    expect(await client.autopilotAct.count({ where: { userId, sector: "debt" } })).toBe(1);
    const [started] = (await fromSource()).filter((m) => m.dedupeKey.includes("plan-started"));
    expect(started).toMatchObject({ kind: "done" });
    // Once: with a plan there's nothing to start.
    expect((await runDebtAutopilot(userId, opts())).planStarted).toBe(false);
  });

  it("answers what Jane does and what's due, by rules and for Claude", async () => {
    const what = await sendToJane(userId, "what do you do about my debts", opts());
    expect(what.reply.body).toMatch(
      /^Your debt autopilot is set to "The safe stuff", so here's what I do by myself\./,
    );
    expect(what.reply.body).toContain(
      "Applying for credit, moving money and signing always wait for your tap.",
    );
    const due = await sendToJane(userId, "when are my loan payments due", opts());
    expect(due.reply.body).toMatch(/^Your next debt payment is \$[\d,.]+ on \w{3} \d+, for your /);
    expect(due.reply.body).toContain("Moving it to the 4th leaves more room before it's taken.");
    const tool = await runChatTool(userId, "debt_autopilot", {}, opts());
    const output = JSON.parse(tool.content);
    expect(output.debtAutopilotLevel).toBe("safe");
    expect(output.dueDateMoves[0].suggestedDay).toBe(4);
    expect(output.rateChanges[0]).toMatchObject({ from: "6.90%", to: "7.15%" });
  });
});
