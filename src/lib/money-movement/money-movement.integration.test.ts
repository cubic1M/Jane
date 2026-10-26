import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { PAYCHECK_BUFFER_MARGIN_CENTS, PAYCHECK_CUSHION_CENTS } from "@/config/money-movement";
import { loadDetectionInput } from "@/detection/engine";
import { forecastAccounts } from "@/detection/forecast";
import { logAudit } from "@/lib/audit";
import { setAutopilot } from "@/lib/autopilot";
import { homeSummary } from "@/lib/home";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { answerByRules } from "@/lib/jane-agent/answer";
import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { postMessages } from "@/lib/jane-agent/messages";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { paycheckSource } from "@/lib/jane-agent/sources/paycheck";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { setSectorAutopilot } from "@/lib/sector-autopilot";
import { moneyPartnerFor } from "./partner";
import { runPaycheckPlan } from "./paycheck";
import {
  TransferError,
  cancelTransfer,
  listTransfers,
  scheduleTransfer,
  settleTransfers,
} from "./transfers";

// Spec step 144 against a real, migrated Postgres, with the demo bank: the day after the
// 15th's payroll, Jane plans the paycheck, moves the goals' shares on its own within Goals'
// autopilot caps through the stand-in (no real money), keeps safe to spend's cushion, lets
// every transfer be undone while pending, and asks with one tap for what autopilot can't do.

const url = process.env.TEST_DATABASE_URL;
// The day after the demo bank's mid-month payroll.
const LINKED = new Date("2026-10-16T15:00:00Z");
const NEXT_DAY = new Date("2026-10-17T15:00:00Z");

describe.runIf(url)("money that moves itself", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const api = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no Plaid");
      },
    },
  ) as PlaidApi;

  async function demoPerson(prefix: string, autopilot: "safe" | "ask" = "safe") {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api, now: LINKED });
    await setAutopilot(user.id, autopilot, { client, now: LINKED });
    await client.savingsGoal.create({
      data: {
        userId: user.id,
        name: "Emergency fund",
        targetCents: 400_000,
        targetDate: new Date("2027-08-01T00:00:00Z"),
        manualSavedCents: 0,
      },
    });
    return user.id;
  }

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

  it("moves a goal's share of the paycheck by itself, above the cushion, once", async () => {
    const userId = await demoPerson("money-auto");
    await client.paycheckPlan.deleteMany({ where: { userId } });
    await client.moneyTransfer.deleteMany({ where: { userId } });
    const plan = (await runPaycheckPlan(userId, { client, now: LINKED }))!;
    expect(plan.paidOn).toBe("2026-10-15");
    const goal = plan.moves.find((m) => m.label === '"Emergency fund"')!;
    expect(goal).toMatchObject({ status: "auto", sector: "goals", purpose: "goal" });
    const safe = (await homeSummary(userId, { client, now: LINKED }))!.safeToSpend!;
    expect(plan.moves.reduce((s, m) => s + m.cents, 0)).toBeLessThanOrEqual(
      safe.balanceCents - safe.billsCents - safe.budgetsLeftCents - PAYCHECK_CUSHION_CENTS,
    );
    const [transfer] = await listTransfers(userId, { client, now: LINKED });
    expect(transfer).toMatchObject({
      status: "pending",
      by: "autopilot",
      undoable: true,
      runOn: "2026-10-17",
    });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "money_transfer_scheduled",
      { type: "money_transfer", id: transfer.id },
      expect.objectContaining({ by: "autopilot", simulated: true }),
    );
    // Spec step 206: what moved never takes checking's forecast low below the margin.
    const input = await loadDetectionInput(userId, { client, now: LINKED });
    const checking = forecastAccounts(input, 30).find((f) => f.accountName.match(/Checking/))!;
    expect(
      checking.lowest.balanceCents - plan.moves.reduce((sum, m) => sum + m.cents, 0),
    ).toBeGreaterThanOrEqual(PAYCHECK_BUFFER_MARGIN_CENTS);
    // Once per paycheck.
    expect((await runPaycheckPlan(userId, { client, now: LINKED }))!.id).toBe(plan.id);
    expect(await client.moneyTransfer.count({ where: { userId } })).toBe(
      plan.moves.filter((m) => m.status === "auto").length,
    );

    // It goes through on its day, and the goal counts it.
    expect(await settleTransfers(userId, { client, now: NEXT_DAY })).toBeGreaterThanOrEqual(1);
    const saved = await client.savingsGoal.findFirstOrThrow({
      where: { userId, name: "Emergency fund" },
    });
    expect(saved.manualSavedCents).toBe(goal.cents);
    await expect(
      cancelTransfer(userId, transfer.id, { client, now: NEXT_DAY }),
    ).rejects.toBeInstanceOf(TransferError);
  });

  it("asks with one tap when the area always asks, and Undo works while pending", async () => {
    const userId = await demoPerson("money-ask");
    await setSectorAutopilot(userId, "goals", { level: "ask" }, { client, now: LINKED });
    await client.paycheckPlan.deleteMany({ where: { userId } });
    await client.moneyTransfer.deleteMany({ where: { userId } });
    await runPaycheckPlan(userId, { client, now: LINKED });
    expect(await client.moneyTransfer.count({ where: { userId } })).toBe(0);

    const snapshot = await loadSnapshot(userId, { client, now: LINKED });
    await postMessages(
      userId,
      gather(snapshot!, LINKED, { trigger: "open", sources: [paycheckSource] }),
      { client, now: LINKED },
    );
    const message = await client.janeMessage.findFirstOrThrow({
      where: { userId, dedupeKey: { startsWith: "paycheck:" } },
    });
    expect(message.body).toMatch(
      /^Your \$[\d,]+\.\d\d paycheck came in\. Want me to move \$[\d,]+\.\d\d to "Emergency fund"/,
    );
    expect(message.body).toContain("These are sample transfers: no real money moves.");
    // Spec step 206: one line on where every dollar went.
    expect(message.body).toMatch(/Where it went: .*yours to spend\./);
    const { message: answered } = await takeChatAction(userId, message.id, "paycheck.move", {
      client,
      now: LINKED,
    });
    expect(answered.refs.note).toMatch(/^Done\. \$[\d,]+\.\d\d is on its way/);
    const [transfer] = await listTransfers(userId, { client, now: LINKED });
    expect(transfer).toMatchObject({ status: "pending", by: "person" });
    await cancelTransfer(userId, transfer.id, { client, now: LINKED });
    expect((await listTransfers(userId, { client, now: LINKED }))[0]).toMatchObject({
      status: "cancelled",
      undoable: false,
    });

    expect(
      (await answerByRules(userId, { kind: "paycheck" }, { client, now: LINKED }))?.body,
    ).toMatch(/paycheck came in/);
    const tool = JSON.parse(
      (await runChatTool(userId, "money_moves", {}, { client, now: LINKED })).content,
    );
    expect(tool.sampleOnly).toBe(true);
    expect(tool.transfers[0]).toMatchObject({ status: "cancelled" });
  });

  it("says when the next paycheck comes when there's none to split yet", async () => {
    const userId = await demoPerson("money-next");
    const later = new Date("2026-10-25T15:00:00Z");
    expect(
      (await answerByRules(userId, { kind: "paycheck" }, { client, now: later }))?.body,
    ).toMatch(
      /^I split each paycheck when it lands\. Your next one is Nov 1 \(in 7 days\): about \$[\d,.]+ from /,
    );
  });

  it("never moves money for real accounts, nor between someone else's accounts", async () => {
    const real = await client.user.create({
      data: { email: `money-real-${crypto.randomUUID()}@example.com` },
    });
    created.push(real.id);
    const account = await client.account.create({
      data: {
        userId: real.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    expect(await moneyPartnerFor(real.id, { client })).toBeNull();
    expect(await runPaycheckPlan(real.id, { client, now: LINKED })).toBeNull();
    await expect(
      scheduleTransfer(
        real.id,
        {
          fromAccountId: account.id,
          toAccountId: null,
          toName: "x",
          amountCents: 100,
          purpose: "goal",
          sector: "goals",
        },
        "person",
        { client, now: LINKED },
      ),
    ).rejects.toThrow(/money-movement partner/);

    const demo = await demoPerson("money-mine");
    await expect(
      scheduleTransfer(
        demo,
        {
          fromAccountId: account.id,
          toAccountId: null,
          toName: "x",
          amountCents: 100,
          purpose: "goal",
          sector: "goals",
        },
        "person",
        { client, now: LINKED },
      ),
    ).rejects.toThrow("Transfers only go between your own accounts.");
  });
});
