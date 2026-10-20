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
import { clearW4Change, loadWithholding } from "@/lib/tax-withholding";
import { savePayStub } from "@/lib/tax-profile";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { parseActions, parseRefs } from "./types";
import { sendToJane } from "./typing";

// Spec step 121 against a real, migrated Postgres: the demo bank's withholding is heading
// for a big refund; in demo advice mode Jane says what to put on a new W-4 and walks
// through it in one message, and "I've sent it" moves the estimate to a small refund. Real
// accounts get the comparison and the IRS estimator, never the suggestion.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("the withholding checkup against a real database", () => {
  let client: PrismaClient;
  let demoId: string;
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

  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }
  async function post(userId: string, dedupeKey: string) {
    const candidate = taxesSource
      .gather((await loadSnapshot(userId, { client, now: LINKED }))!, context)
      .find((c) => c.dedupeKey === dedupeKey);
    if (!candidate) return null;
    return client.janeMessage.create({
      data: {
        userId,
        kind: candidate.kind,
        body: candidate.body,
        refs: candidate.refs,
        actions: candidate.actions,
        dedupeKey: `taxes:${candidate.dedupeKey}`,
      },
    });
  }
  const tap = async (userId: string, messageId: string, id: string) =>
    (await takeChatAction(userId, messageId, id, { client, now: later() })).message;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    demoId = await person("tax-w4-demo");
    const { itemId } = await linkDemoBank(demoId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("the demo bank is heading for a big refund, and demo advice says what to put", async () => {
    const view = await loadWithholding(demoId, { client, now: LINKED });
    expect(view.advice).toBe(true);
    expect(view.check.status).toBe("big_refund");
    if (view.check.status !== "big_refund") return;
    expect(view.check.paychecksLeft).toBe(4);
    expect(view.check.thisYear?.step).toBe("4b");
  });

  it("walks through a new W-4 in one message, and I've sent it moves the estimate to a small refund", async () => {
    const before = (await loadTaxEstimate(demoId, { client, now: LINKED })).estimate.refundCents;
    const suggested = (await loadWithholding(demoId, { client, now: LINKED })).check;
    const planned =
      suggested.status === "big_refund" ? (suggested.thisYear?.refundAfterCents ?? null) : null;
    const message = (await post(demoId, "withholding:2026:big_refund"))!;
    expect(message.kind).toBe("decision");
    expect(parseRefs(message.refs).advice).toBe(true);
    expect(message.body).toMatch(/^You're on course for a refund of about \$[\d,]+ for 2026\./);
    expect(message.body).toContain("Step 4(b), Deductions");
    expect(parseActions(message.actions).map((a) => a.id)).toEqual([
      "tax.w4_start",
      "tax.w4_keep",
      "snooze",
    ]);

    let after = await tap(demoId, message.id, "tax.w4_start");
    expect(after.body).toMatch(/^Step 1 of 3: get a new Form W-4/);
    after = await tap(demoId, message.id, "tax.w4_next");
    expect(after.body).toMatch(
      /^Step 2 of 3: keep Steps 1 to 3 as they are now, and in Step 4\(b\), Deductions, put \$[\d,.]+\./,
    );
    after = await tap(demoId, message.id, "tax.w4_next");
    expect(after.body).toMatch(/^Step 3 of 3: sign it/);
    after = await tap(demoId, message.id, "tax.w4_sent");
    expect(after.status).toBe("answered");
    expect(after.refs.note).toMatch(
      /^Got it\. I'm counting it from your next paycheck: your estimate is now /,
    );

    const view = await loadTaxEstimate(demoId, { client, now: LINKED });
    expect(view.w4).toMatchObject({ step: "4b", changedOn: "2026-10-18" });
    // The acceptance: toward zero owed and a small refund. With 4 paychecks left, the
    // most this year's change can do is stop federal withholding for them; from January the
    // full-year change lands on the small refund (src/planning/withholding.test.ts).
    expect(view.estimate.refundCents).toBeLessThan(before);
    expect(view.estimate.refundCents).toBeGreaterThanOrEqual(0);
    expect(planned).not.toBeNull();
    expect(Math.abs(view.estimate.refundCents - planned!)).toBeLessThan(1_000);
    expect(view.assumptions).toContain("It includes the W-4 change you sent on Oct 18, 2026.");
    // Sent: Jane doesn't bring it up again this year.
    expect(await post(demoId, "withholding:2026:big_refund")).toBeNull();
    await clearW4Change(demoId, { client, via: "page" });
  });

  it("Keep my refund stops the suggestion for the year", async () => {
    await client.janeMessage.deleteMany({
      where: { userId: demoId, dedupeKey: { startsWith: "taxes:withholding" } },
    });
    const message = (await post(demoId, "withholding:2026:big_refund"))!;
    const after = await tap(demoId, message.id, "tax.w4_keep");
    expect(after.refs.note).toBe("OK. I won't bring it up again this year.");
    expect(await post(demoId, "withholding:2026:big_refund")).toBeNull();
  });

  it("answers am I withholding too much, with the walk-through in demo advice", async () => {
    const { reply } = await sendToJane(demoId, "am I withholding too much?", {
      client,
      now: later(),
    });
    expect(reply.body).toContain("Step 4(b), Deductions");
    expect(parseRefs(reply.refs).advice).toBe(true);
    const tool = JSON.parse(
      (await runChatTool(demoId, "tax_withholding", {}, { client, now: LINKED })).content,
    );
    expect(tool).toMatchObject({ status: "big_refund", isAnEstimate: true });
    expect(tool.demoAdvice.fromJanuary.w4Step).toContain("Step 4(b)");
  });

  it("real accounts get the comparison and the IRS estimator, never the suggestion", async () => {
    const userId = await person("tax-w4-real");
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    await client.transaction.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        userId,
        accountId: account.id,
        source: "csv" as const,
        date: new Date(Date.UTC(2026, Math.floor(i / 2), i % 2 === 0 ? 1 : 15)),
        amountCents: -300_000,
        description: "GLOBEX PAYROLL",
        pfcDetailed: "INCOME_SALARY",
      })),
    });
    await savePayStub(
      userId,
      {
        asOf: "2026-10-15",
        grossCents: 8_000_000,
        federalCents: 2_000_000,
        stateCents: 0,
        retirementCents: 0,
        pretaxCents: 0,
      },
      { client, now: LINKED, via: "page" },
    );
    const view = await loadWithholding(userId, { client, now: LINKED });
    expect(view.advice).toBe(false);
    expect(view.check.status).toBe("big_refund");
    const message = (await post(userId, "withholding:2026:big_refund"))!;
    expect(message.kind).toBe("heads_up");
    expect(message.body).toContain("The IRS's Tax Withholding Estimator");
    expect(parseRefs(message.refs).advice).toBeUndefined();
    expect(message.body).not.toContain("Step 4");
    // The walk-through is refused even if the button were offered.
    await client.janeMessage.update({
      where: { id: message.id },
      data: { actions: [{ id: "tax.w4_start", label: "Walk me through it", kind: "primary" }] },
    });
    await expect(takeChatAction(userId, message.id, "tax.w4_start", { client })).rejects.toThrow(
      "only offered in demo advice mode",
    );
    const tool = JSON.parse(
      (await runChatTool(userId, "tax_withholding", {}, { client, now: LINKED })).content,
    );
    expect(tool.demoAdvice).toMatch(/^Not available/);
  });
});
