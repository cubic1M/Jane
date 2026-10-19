import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { RefundError, applyRefundPlan, loadRefunds } from "@/lib/tax-refund";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { parseActions, parseRefs } from "./types";
import { sendToJane } from "./typing";

// Spec step 125 against a real, migrated Postgres: a federal refund lands in the demo
// checking account; it's matched to the estimate for its year; in demo advice mode the plan
// is set up with one tap, adding goals and reminders and moving nothing.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("tax refunds against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let refundId: string;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;
  let tick = 0;
  const later = () => new Date(LINKED.getTime() + ++tick * MINUTE);

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `tax-refund-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    created.push(userId);
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    const checking = await client.account.findFirstOrThrow({
      where: { userId, subtype: "checking" },
    });
    const refund = await client.transaction.create({
      data: {
        userId,
        accountId: checking.id,
        source: "plaid",
        date: new Date("2026-10-08T00:00:00Z"),
        amountCents: -320_000,
        description: "IRS TREAS 310 TAX REF",
        pfcDetailed: "INCOME_TAX_REFUND",
      },
    });
    refundId = refund.id;
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("spots the refund and matches it to the estimate for its year", async () => {
    const { advice, refunds } = await loadRefunds(userId, { client, now: LINKED });
    expect(advice).toBe(true);
    expect(refunds).toHaveLength(1);
    const [r] = refunds;
    expect(r.refund).toEqual({
      transactionId: refundId,
      date: "2026-10-08",
      cents: 320_000,
      to: "federal",
      taxYear: 2025,
    });
    const estimate = await loadTaxEstimate(userId, { client, now: LINKED, year: 2025 });
    expect(r.match?.estimatedCents).toBe(estimate.estimate.refundCents);
    expect(r.match?.diffCents).toBe(320_000 - estimate.estimate.refundCents);
    expect(r.plan?.items.length).toBeGreaterThan(0);
  });

  it("brings it up with a plan, and Set it up adds goals and reminders, moving nothing", async () => {
    const candidate = taxesSource
      .gather((await loadSnapshot(userId, { client, now: LINKED }))!, context)
      .find((c) => c.dedupeKey === `refund:${refundId}`)!;
    expect(candidate.kind).toBe("decision");
    expect(candidate.body).toMatch(/^Your federal tax refund of \$3,200\.00 landed on Oct 8\./);
    expect(candidate.body).toContain("Where it could go:");
    expect(candidate.refs.advice).toBe(true);
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: candidate.kind,
        body: candidate.body,
        refs: candidate.refs,
        actions: candidate.actions,
        dedupeKey: `taxes:${candidate.dedupeKey}`,
      },
    });
    expect(parseActions(message.actions).map((a) => a.id)).toEqual([
      "tax.refund_apply",
      "tax.refund_no",
    ]);
    const transactionsBefore = await client.transaction.count({ where: { userId } });
    const after = (
      await takeChatAction(userId, message.id, "tax.refund_apply", { client, now: later() })
    ).message;
    expect(after.refs.note).toMatch(/^Done: \d+ reminders? (?:is|are) on your deadlines\./);
    expect(
      await client.deadline.count({ where: { userId, note: "From your tax refund." } }),
    ).toBeGreaterThan(0);
    expect(await client.transaction.count({ where: { userId } })).toBe(transactionsBefore);
    // Once.
    await expect(
      applyRefundPlan(userId, refundId, { client, now: LINKED, via: "page" }),
    ).rejects.toBeInstanceOf(RefundError);
    expect(
      taxesSource
        .gather((await loadSnapshot(userId, { client, now: LINKED }))!, context)
        .some((c) => c.dedupeKey === `refund:${refundId}`),
    ).toBe(false);
  });

  it("answers where's my refund, and gives Claude the refunds", async () => {
    const { reply } = await sendToJane(userId, "where's my refund", { client, now: later() });
    expect(reply.body).toMatch(/^Your federal tax refund of \$3,200\.00 landed on Oct 8\./);
    expect(parseRefs(reply.refs).taxRefund).toBe(refundId);
    const tool = JSON.parse(
      (await runChatTool(userId, "tax_refunds", {}, { client, now: LINKED })).content,
    );
    expect(tool.refunds[0]).toMatchObject({
      to: "federal",
      amount: "$3,200.00",
      taxYear: 2025,
      planSetUp: true,
    });
  });

  it("real accounts see the refund and the match, never a plan", async () => {
    const otherId = (
      await client.user.create({
        data: { email: `tax-refund-real-${crypto.randomUUID()}@example.com` },
      })
    ).id;
    created.push(otherId);
    const account = await client.account.create({
      data: {
        userId: otherId,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    await client.transaction.create({
      data: {
        userId: otherId,
        accountId: account.id,
        source: "csv",
        date: new Date("2026-10-08T00:00:00Z"),
        amountCents: -50_000,
        description: "IRS TREAS 310 TAX REF",
        pfcDetailed: null,
      },
    });
    const { advice, refunds } = await loadRefunds(otherId, { client, now: LINKED });
    expect(advice).toBe(false);
    expect(refunds[0].plan).toBeNull();
    await expect(
      applyRefundPlan(otherId, refunds[0].refund.transactionId, {
        client,
        now: LINKED,
        via: "page",
      }),
    ).rejects.toThrow("only offered in demo advice mode");
  });
});
