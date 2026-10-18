import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { findingOfType } from "./__fixtures__/findings";
import {
  RuleError,
  applyStandingRules,
  recentRuleApprovals,
  rulesFor,
  saveRules,
  undoRuleApproval,
} from "./standing-rules";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T12:00:00Z");

describe.runIf(url)("standing rules against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person() {
    const user = await client.user.create({
      data: { email: `rules-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }

  async function finding(userId: string, type: Parameters<typeof findingOfType>[0], cents = 3_400) {
    const f = findingOfType(type);
    return client.finding.create({
      data: {
        userId,
        type: f.type,
        key: `${f.key}-${crypto.randomUUID()}`,
        title: f.title,
        annualSavingsCents: cents,
        amountCents: f.amountCents,
        confidence: f.confidence,
        evidence: f.evidence as Prisma.InputJsonObject,
      },
      select: { id: true },
    });
  }

  const on = (key: string, monthlyLimit = 3, maxAnnualCents: number | null = null) => ({
    key,
    enabled: true,
    monthlyLimit,
    maxAnnualCents,
  });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("does nothing until the person turns a rule on", async () => {
    const userId = await person();
    await finding(userId, "bank_fees");
    expect(await applyStandingRules(userId, { client, now: NOW })).toEqual([]);
    expect((await rulesFor(userId, { client })).every((r) => !r.enabled)).toBe(true);
  });

  it("approves only matching findings, as decisions by that rule, within the monthly limit", async () => {
    const userId = await person();
    const fees = [await finding(userId, "bank_fees"), await finding(userId, "bank_fees")];
    const idle = await finding(userId, "idle_cash", 50_000);
    await saveRules(userId, [on("recover_bank_fees", 1)], { client });

    const approvals = await applyStandingRules(userId, { client, now: NOW });
    expect(approvals).toEqual([
      expect.objectContaining({ findingId: fees[0].id, ruleKey: "recover_bank_fees" }),
    ]);
    const decision = await client.decision.findFirstOrThrow({ where: { findingId: fees[0].id } });
    expect(decision).toMatchObject({ source: "rule", ruleKey: "recover_bank_fees", choice: "yes" });
    expect(await client.action.count({ where: { decisionId: decision.id } })).toBe(1);
    // The limit of one a month holds on the next scan; idle cash is never a rule's.
    expect(await applyStandingRules(userId, { client, now: NOW })).toEqual([]);
    expect(
      await client.decision.count({ where: { findingId: { in: [fees[1].id, idle.id] } } }),
    ).toBe(0);
    // A new month, a new allowance.
    const nextMonth = new Date("2026-11-02T12:00:00Z");
    expect(await applyStandingRules(userId, { client, now: nextMonth })).toHaveLength(1);
  });

  it("stops at once when a rule is turned off", async () => {
    const userId = await person();
    await saveRules(userId, [on("recover_bank_fees")], { client });
    await saveRules(userId, [{ ...on("recover_bank_fees"), enabled: false }], { client });
    await finding(userId, "bank_fees");
    expect(await applyStandingRules(userId, { client, now: NOW })).toEqual([]);
  });

  it("can be taken back for a day before work starts, and the rule then leaves it alone", async () => {
    const userId = await person();
    const fee = await finding(userId, "bank_fees");
    await saveRules(userId, [on("recover_bank_fees")], { client });
    const [approval] = await applyStandingRules(userId, { client, now: NOW });

    expect(await recentRuleApprovals(userId, { client, now: NOW })).toEqual([
      expect.objectContaining({ decisionId: approval.decisionId, canUndo: true }),
    ]);
    await undoRuleApproval(userId, approval.decisionId, { client, now: NOW });
    expect(await client.action.count({ where: { userId } })).toBe(0);
    expect((await client.finding.findUniqueOrThrow({ where: { id: fee.id } })).status).toBe(
      "shown",
    );
    expect(await applyStandingRules(userId, { client, now: NOW })).toEqual([]);
  });

  it("can't be taken back once the work has started or after a day", async () => {
    const userId = await person();
    await finding(userId, "bank_fees");
    await finding(userId, "duplicate_charge", 6_420);
    await saveRules(userId, [on("recover_bank_fees"), on("refund_double_charges")], { client });
    const [first, second] = await applyStandingRules(userId, { client, now: NOW });

    await client.action.updateMany({
      where: { decisionId: first.decisionId },
      data: { status: "in_progress" },
    });
    await expect(undoRuleApproval(userId, first.decisionId, { client, now: NOW })).rejects.toThrow(
      "work has started",
    );
    // Decisions are stamped with the real time, so "a day later" counts from now.
    const later = new Date(Date.now() + 25 * 3_600_000);
    await expect(
      undoRuleApproval(userId, second.decisionId, { client, now: later }),
    ).rejects.toThrow();
    // Someone else's approval can't be taken back either.
    await expect(
      undoRuleApproval(await person(), second.decisionId, { client, now: NOW }),
    ).rejects.toThrow();
  });

  it("refuses unknown rules, odd limits and a missing amount", async () => {
    const userId = await person();
    await expect(saveRules(userId, [on("move_all_my_money")], { client })).rejects.toBeInstanceOf(
      RuleError,
    );
    await expect(
      saveRules(userId, [on("recover_bank_fees", 7)], { client }),
    ).rejects.toBeInstanceOf(RuleError);
    await expect(
      saveRules(userId, [on("fight_price_increases", 3, null)], { client }),
    ).rejects.toBeInstanceOf(RuleError);
  });
});
