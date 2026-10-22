import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { DEFAULT_BIG_MOVE_CENTS } from "@/config/money-for-two";
import { logAudit } from "@/lib/audit";
import { sharedReadFor } from "@/lib/db-scoped";
import { acceptInvite, invitePartner, setAccountSharing } from "@/lib/household";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { answerByRules } from "@/lib/jane-agent/answer";
import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { parseIntent } from "@/lib/jane-agent/intents";
import { postMessages } from "@/lib/jane-agent/messages";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { twoSource } from "@/lib/jane-agent/sources/two";
import { cancelTransfer, scheduleTransfer } from "@/lib/money-movement/transfers";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadProfileInput } from "@/lib/profile";
import {
  MoneyForTwoError,
  approveBigMove,
  declineBigMove,
  loadMoneyForTwo,
  setBigMoveLimit,
  setGoalSharing,
  setSplitRule,
  splitShareFor,
} from "./money-for-two";

// Spec step 242 against a real, migrated Postgres: two partners, each with the demo bank, in
// one household. Private accounts and goals never reach the partner; bills split evenly or by
// income as they choose (only the shares are shown); a big move out of a shared account waits
// for the other's tap; and both get the money date.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-16T15:00:00Z");

describe.runIf(url)("money for two", { timeout: 120_000 }, () => {
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

  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com`, name: prefix },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW });
    await syncItem(itemId, { client, api, now: NOW });
    return { id: user.id, email: user.email };
  }

  async function couple() {
    const a = await person("dan");
    const b = await person("lena");
    const { token } = await invitePartner(a, b.email, { client, now: NOW });
    await acceptInvite(b, token, { client, now: NOW });
    const checking = (id: string) =>
      client.account.findFirstOrThrow({ where: { userId: id, subtype: "checking" } });
    const savings = (id: string) =>
      client.account.findFirstOrThrow({ where: { userId: id, subtype: "savings" } });
    return { a, b, checking, savings };
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("never shows a partner what wasn't shared: accounts, goals or moves", async () => {
    const { a, b, checking } = await couple();
    await client.savingsGoal.create({
      data: {
        userId: a.id,
        name: "Dan's own fund",
        targetCents: 100_000,
        targetDate: new Date("2027-06-01T00:00:00Z"),
        manualSavedCents: 10_000,
      },
    });
    const joint = await client.savingsGoal.create({
      data: {
        userId: a.id,
        name: "Our anniversary trip",
        targetCents: 300_000,
        targetDate: new Date("2027-05-01T00:00:00Z"),
        manualSavedCents: 50_000,
      },
    });
    expect(await setGoalSharing(a.id, joint.id, true, { client })).toBe(true);
    // Lena can't make Dan's goal joint, nor private again.
    expect(await setGoalSharing(b.id, joint.id, false, { client })).toBe(false);

    const lena = (await loadMoneyForTwo(b.id, { client, now: NOW }))!;
    expect(lena.jointGoals.map((g) => g.name)).toEqual(["Our anniversary trip"]);
    expect(lena.jointGoals[0]).toMatchObject({ mine: false, savedCents: 50_000 });
    // Nothing of Dan's is visible until he shares an account.
    expect((await sharedReadFor(b.id, client)).accounts).toEqual([]);
    // A move out of Dan's own (unshared) account goes at once, and Lena never sees it.
    const own = await scheduleTransfer(
      a.id,
      {
        fromAccountId: (await checking(a.id)).id,
        toAccountId: null,
        toName: "Landlord",
        amountCents: DEFAULT_BIG_MOVE_CENTS * 3,
        purpose: "bill",
        sector: "bills",
      },
      "person",
      { client, now: NOW },
    );
    expect(own.awaitingPartner).toBeUndefined();
    expect((await loadMoneyForTwo(b.id, { client, now: NOW }))!.bigMoves).toEqual([]);
    // Only the shares, never either income.
    expect(Object.keys(lena).sort()).toEqual(
      [
        "bigMoveCents",
        "bigMoves",
        "chosen",
        "incomeMyShareBps",
        "jointGoals",
        "month",
        "myShareBps",
        "owedToMeCents",
        "partnerName",
        "rule",
        "sharedSpentCents",
      ].sort(),
    );
  });

  it("splits bills evenly or by income, as either partner chooses for both", async () => {
    const { a, b, checking } = await couple();
    expect(await splitShareFor(a.id, { client, now: NOW })).toBe(5_000);
    // Lena earns half of what Dan does in the last 90 days.
    const lenaChecking = await checking(b.id);
    await client.transaction.updateMany({
      where: { userId: b.id, accountId: lenaChecking.id, amountCents: { lt: 0 } },
      data: { pfcDetailed: "OTHER" },
    });
    await client.transaction.create({
      data: {
        userId: b.id,
        accountId: lenaChecking.id,
        source: "plaid",
        date: new Date("2026-10-01T00:00:00Z"),
        amountCents: -100_000,
        description: "COUNTY LIBRARY PAYROLL",
        pfcPrimary: "INCOME",
        pfcDetailed: "INCOME_SALARY",
      },
    });
    const danChecking = await checking(a.id);
    await client.transaction.updateMany({
      where: { userId: a.id, accountId: danChecking.id, amountCents: { lt: 0 } },
      data: { pfcDetailed: "OTHER" },
    });
    await client.transaction.create({
      data: {
        userId: a.id,
        accountId: danChecking.id,
        source: "plaid",
        date: new Date("2026-10-01T00:00:00Z"),
        amountCents: -200_000,
        description: "MERIDIAN LOGISTICS PAYROLL",
        pfcPrimary: "INCOME",
        pfcDetailed: "INCOME_SALARY",
      },
    });
    await expect(setSplitRule(b.id, "thirds", { client, now: NOW })).rejects.toThrow(
      MoneyForTwoError,
    );
    expect(await setSplitRule(b.id, "income", { client, now: NOW })).toBe("income");
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      { type: "user", id: b.id },
      "household_split_set",
      expect.objectContaining({ type: "household" }),
      { rule: "income" },
    );
    // From Dan's side, Lena's share is a third; from Lena's, Dan's is two thirds.
    expect(await splitShareFor(a.id, { client, now: NOW })).toBe(3_333);
    expect(await splitShareFor(b.id, { client, now: NOW })).toBe(6_667);
    const dan = (await loadMoneyForTwo(a.id, { client, now: NOW }))!;
    expect(dan).toMatchObject({ rule: "income", chosen: true, myShareBps: 6_667 });
    const input = await loadProfileInput(a.id, { client, now: NOW });
    expect(input.extras?.splitChosen).toBe(true);
  });

  it("holds a big move out of a shared account for the other partner's tap", async () => {
    const { a, b, checking, savings } = await couple();
    const shared = await checking(a.id);
    await setAccountSharing(a.id, shared.id, true, { client });
    await setBigMoveLimit(a.id, 50_000, { client });
    await expect(setBigMoveLimit(a.id, 5, { client })).rejects.toThrow(MoneyForTwoError);
    const move = (cents: number) =>
      scheduleTransfer(
        a.id,
        {
          fromAccountId: shared.id,
          toAccountId: null,
          toName: "Car dealer",
          amountCents: cents,
          purpose: "bill",
          sector: "bills",
        },
        "person",
        { client, now: NOW },
      );
    // Under the amount: it goes at once.
    expect((await move(49_999)).awaitingPartner).toBeUndefined();
    const big = await move(80_000);
    expect(big.awaitingPartner).toBe(true);
    const row = await client.moneyTransfer.findUniqueOrThrow({ where: { id: big.id } });
    expect(row).toMatchObject({ status: "awaiting_partner", partnerRef: null });

    // Dan can't approve his own; a stranger can't either.
    await expect(approveBigMove(a.id, big.id, { client, now: NOW })).rejects.toThrow(
      MoneyForTwoError,
    );
    // Lena sees it waiting for her, in the chat with Approve and Decline.
    const snapshot = (await loadSnapshot(b.id, { client, now: NOW }))!;
    await postMessages(b.id, gather(snapshot, NOW, { trigger: "open", sources: [twoSource] }), {
      client,
      now: NOW,
    });
    const ask = await client.janeMessage.findFirstOrThrow({
      where: { userId: b.id, dedupeKey: `two:move:${big.id}` },
    });
    expect(ask.body).toMatch(/wants to move \$800\.00 to Car dealer/);
    const date = await client.janeMessage.findFirstOrThrow({
      where: { userId: b.id, dedupeKey: { startsWith: "two:date:" } },
    });
    expect(date.body).toMatch(/^Money date with dan: /);
    expect(date.body).toMatch(/1 big move waits for your tap\./);
    const { message } = await takeChatAction(b.id, ask.id, "two.approve", { client, now: NOW });
    expect(message.refs.note).toMatch(/^Approved\. \$800\.00 goes on 2026-10-1\d\.$/);
    expect(await client.moneyTransfer.findUniqueOrThrow({ where: { id: big.id } })).toMatchObject({
      status: "pending",
      approvedById: b.id,
    });

    // Declined, nothing moves; Dan can also undo one still waiting.
    const second = await move(90_000);
    await declineBigMove(b.id, second.id, { client, now: NOW });
    expect(
      (await client.moneyTransfer.findUniqueOrThrow({ where: { id: second.id } })).status,
    ).toBe("cancelled");
    const third = await move(90_000);
    await cancelTransfer(a.id, third.id, { client, now: NOW });
    expect((await client.moneyTransfer.findUniqueOrThrow({ where: { id: third.id } })).status).toBe(
      "cancelled",
    );
    void savings;
  });

  it("is in the chat: the rule answer, Claude's tool and the split buttons", async () => {
    const { a } = await couple();
    expect(parseIntent("how should we split the bills?", "2026-10-16")).toEqual({
      kind: "money_for_two",
    });
    const reply = (await answerByRules(a.id, { kind: "money_for_two" }, { client, now: NOW }))!;
    expect(reply.body).toMatch(/^Shared bills split half each\./);
    expect(reply.actions.map((x) => x.id)).toEqual(["two.split_income", "two.split_even", "open"]);
    const tool = JSON.parse(
      (await runChatTool(a.id, "money_for_two", {}, { client, now: NOW })).content,
    );
    expect(tool.split).toBe("even");
    expect(tool).not.toHaveProperty("partnerIncome");

    const alone = await person("alone");
    expect(
      (await answerByRules(alone.id, { kind: "money_for_two" }, { client, now: NOW }))!.body,
    ).toMatch(/^Invite your partner on Household/);
    expect(await loadMoneyForTwo(alone.id, { client, now: NOW })).toBeNull();
  });
});
