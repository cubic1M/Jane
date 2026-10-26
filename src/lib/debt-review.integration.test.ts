import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { debtReviewSource } from "@/lib/jane-agent/sources/debt-review";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseActions, parseRefs } from "@/lib/jane-agent/types";
import { setAutopilot } from "@/lib/autopilot";
import { pullCredit } from "@/lib/credit";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { runCreditMonthly } from "@/lib/credit-monthly";
import { setSectorAutopilot } from "@/lib/sector-autopilot";
import { loadDebtReview, runDebtReview } from "./debt-review";

// Spec step 230 against a real, migrated Postgres, on the demo bank (six days before a card's
// statement closes): the first debt review, what Jane does at each level within the debt caps,
// one message with a button for each item that stays open until each is used, and the
// reasons for a review to come early.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
// Six days before the statement closes on November 1.
const NEAR = new Date("2026-10-27T15:00:00Z");
const DAY = 86_400_000;
const MINUTE = 60 * 1000;
const context = { now: NEAR, local: { date: "2026-10-27", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("the yearly debt review against a real database", { timeout: 120_000 }, () => {
  let client: PrismaClient;
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
  const later = () => new Date(NEAR.getTime() + ++tick * MINUTE);
  const opts = (now = NEAR) => ({ client, now });
  async function demoPerson(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    await pullCredit(user.id, opts());
    return user.id;
  }
  // Linking the demo bank did the first review (at Ask me first, so nothing was done); clear it
  // so a review can be done at a chosen level on a chosen day.
  const fresh = (id: string) =>
    client.debtWatch.update({
      where: { userId: id },
      data: { reviewOn: null, reviewReason: null, reviewKeys: [], reviewPayCents: null },
    });
  const level = async (id: string, l: "safe" | "all", actionCap = 200_000) => {
    await setAutopilot(id, l, { client });
    await setSectorAutopilot(
      id,
      "debt",
      { level: l, actionCapCents: actionCap, monthlyCapCents: 300_000 },
      { client, now: NEAR },
    );
  };
  const fromSource = async (id: string) =>
    debtReviewSource.gather((await loadSnapshot(id, opts()))!, context);

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("does the first review at Ask me first without doing anything, and not again", async () => {
    const id = await demoPerson("rev-ask");
    // Done when the bank was linked, with nothing done by Jane at Ask me first.
    expect((await loadDebtReview(id, opts(LINKED))).review).toEqual({
      on: "2026-10-18",
      reason: "first",
    });
    expect(await runDebtReview(id, opts(LINKED))).toBeNull();
    expect(await client.moneyTransfer.count({ where: { userId: id } })).toBe(0);
    await fresh(id);
    expect((await loadDebtReview(id, opts())).due).toBe("first");
    const ran = await runDebtReview(id, opts());
    expect(ran).toEqual({ reason: "first", did: [] });
    expect(await client.moneyTransfer.count({ where: { userId: id } })).toBe(0);
    expect(await client.cardRateRequest.count({ where: { userId: id } })).toBe(0);
    expect(await runDebtReview(id, opts())).toBeNull();
    const review = await loadDebtReview(id, opts());
    expect(review).toMatchObject({ available: true, level: "ask", due: null });
    expect(review.review).toEqual({ on: "2026-10-27", reason: "first" });
    expect(review.items.map((i) => [i.key, i.status])).toEqual([
      ["statements", "tap"],
      ["promos", "ok"],
      ["rates", "tap"],
      ["home", "tap"],
    ]);
    expect(logAuditCalled(id)).toBe(true);
  });

  it("posts one message with a button for each item, which stays open until each is used", async () => {
    const id = await demoPerson("rev-msg");
    await fresh(id);
    await runDebtReview(id, opts());
    const [m] = await fromSource(id);
    expect(m).toMatchObject({ kind: "decision", dedupeKey: "debtreview:2026-10-27" });
    expect(m.body).toMatch(/^Here's your first debt review: 3 things need you\./);
    expect(m.body).toContain("Payments timed to statement dates (Needs you)");
    expect(parseActions(m.actions).map((a) => a.id)).toEqual([
      "credit_build.pay",
      "cardrate.send",
      "open",
      "open",
      "snooze",
    ]);
    expect(m.refs.reviewButtons).toEqual(["credit_build.pay", "cardrate.send"]);

    // In the chat, the same message; each tap handles its own item and the rest stay.
    const { reply } = await sendToJane(id, "do my yearly debt review", { client, now: later() });
    expect(parseRefs(reply.refs).reviewButtons).toEqual(["credit_build.pay", "cardrate.send"]);
    const first = await takeChatAction(id, reply.id, "credit_build.pay", { client, now: later() });
    expect(first.message.status).toBe("open");
    expect(first.message.refs.note).toMatch(/^Scheduled: \$[\d,.]+ to your Demo Credit Card/);
    expect(first.message.actions.some((a) => a.id === "credit_build.pay")).toBe(false);
    expect(first.message.actions.some((a) => a.id === "cardrate.send")).toBe(true);
    const second = await takeChatAction(id, reply.id, "cardrate.send", { client, now: later() });
    expect(second.message.status).toBe("answered");
    expect(second.message.actions.some((a) => a.kind !== "link")).toBe(false);
    expect(await client.moneyTransfer.count({ where: { userId: id } })).toBe(1);
    expect(await client.cardRateRequest.count({ where: { userId: id } })).toBe(1);
    // The first button can't be used twice.
    await expect(
      takeChatAction(id, reply.id, "credit_build.pay", { client, now: later() }),
    ).rejects.toThrow();
  });

  it("at Handle the safe stuff pays before the statement on its own, within the caps", async () => {
    const id = await demoPerson("rev-safe");
    await fresh(id);
    await level(id, "safe");
    const ran = await runDebtReview(id, opts());
    expect(ran!.did).toEqual(["a payment before a statement"]);
    expect(await client.moneyTransfer.count({ where: { userId: id, by: "autopilot" } })).toBe(1);
    expect(await client.cardRateRequest.count({ where: { userId: id } })).toBe(0);
    const review = await loadDebtReview(id, opts());
    const statements = review.items.find((i) => i.key === "statements")!;
    expect(statements.status).toBe("done");
    expect(statements.text).toContain("(I scheduled it within your caps)");
    // The rate request is still the person's tap.
    expect(review.items.find((i) => i.key === "rates")!.status).toBe("tap");
    const [m] = await fromSource(id);
    expect(m.refs.reviewButtons).toEqual(["cardrate.send"]);
  });

  it("never pays above a cap without a tap", async () => {
    const id = await demoPerson("rev-cap");
    await fresh(id);
    await level(id, "safe", 100);
    const ran = await runDebtReview(id, opts());
    expect(ran!.did).toEqual([]);
    expect(await client.moneyTransfer.count({ where: { userId: id } })).toBe(0);
    expect((await loadDebtReview(id, opts())).items[0]).toMatchObject({
      key: "statements",
      status: "tap",
    });
  });

  it("at Handle everything also sends the next lower-rate request, free of any cap", async () => {
    const id = await demoPerson("rev-all");
    await fresh(id);
    await level(id, "all");
    const ran = await runDebtReview(id, opts());
    expect(ran!.did).toEqual([
      "a payment before a statement",
      expect.stringMatching(/^a lower-rate request to /),
    ]);
    expect(await client.cardRateRequest.count({ where: { userId: id } })).toBe(1);
    expect(await client.autopilotAct.count({ where: { userId: id, sector: "debt" } })).toBe(2);
    const rates = (await loadDebtReview(id, opts())).items.find((i) => i.key === "rates")!;
    expect(rates.status).toBe("done");
    expect(rates.text).toMatch(/^Asked .* for a lower rate this month/);

    // docs/feature-audit.md, cluster 14: next month's check-up, within the month, sends no
    // second request and says the same as the review.
    const month = (await runCreditMonthly(id, opts(new Date(NEAR.getTime() + 7 * DAY))))!;
    expect(month.did).toEqual([]);
    expect(await client.cardRateRequest.count({ where: { userId: id } })).toBe(1);
    expect(month.items.find((i) => i.key === "card_rate")).toMatchObject({
      status: "done",
      text: rates.text,
    });
  });

  it("comes early after a raise, a new loan, and once a year", async () => {
    const id = await demoPerson("rev-early");
    await fresh(id);
    await runDebtReview(id, opts());
    const set = (data: Record<string, unknown>) =>
      client.debtWatch.update({ where: { userId: id }, data });
    // Nothing changed: no review.
    await set({ reviewOn: new Date(NEAR.getTime() - 40 * DAY) });
    expect((await loadDebtReview(id, opts())).due).toBeNull();
    // The paycheck at the last review was lower: a raise.
    await set({ reviewPayCents: 100_000 });
    expect((await loadDebtReview(id, opts())).due).toBe("raise");
    // A debt that wasn't there at the last review.
    await set({ reviewPayCents: null, reviewKeys: [] });
    expect((await loadDebtReview(id, opts())).due).toBe("new_loan");
    // Not twice within a month.
    await set({ reviewOn: new Date(NEAR.getTime() - 5 * DAY) });
    expect((await loadDebtReview(id, opts())).due).toBeNull();
    // A year on.
    await set({ reviewOn: new Date(NEAR.getTime() - 366 * DAY) });
    expect(await runDebtReview(id, opts())).toMatchObject({ reason: "yearly" });
    expect((await loadDebtReview(id, opts())).review).toEqual({
      on: "2026-10-27",
      reason: "yearly",
    });
  });

  it("pulls the stand-in score when asked before the first pull, instead of saying it hasn't checked", async () => {
    const user = await client.user.create({
      data: { email: `rev-score-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    const { reply } = await sendToJane(user.id, "what's my credit score", {
      client,
      now: later(),
    });
    expect(reply.body).not.toContain("haven't checked");
    expect(reply.body).toMatch(/\b\d{3}\b/);
  });

  it("gives Claude the same items, and has nothing for someone without a debt", async () => {
    const id = await demoPerson("rev-tool");
    await fresh(id);
    await runDebtReview(id, opts());
    const out = JSON.parse((await runChatTool(id, "debt_review", {}, opts())).content);
    expect(out.autopilotLevel).toBe("ask");
    expect(out.lastReview).toEqual({ on: "2026-10-27", reason: "first" });
    expect(out.items.map((i: { status: string }) => i.status)).toContain("needs the person's tap");
    const user = await client.user.create({
      data: { email: `rev-none-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    expect(await runDebtReview(user.id, opts())).toBeNull();
    const { reply } = await sendToJane(user.id, "do my yearly debt review", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(/^I don't see a debt with a balance/);
  });
});

function logAuditCalled(id: string) {
  return vi
    .mocked(logAudit)
    .mock.calls.some((c) => c[1] === "debt_review_done" && (c[2] as { id: string }).id === id);
}
