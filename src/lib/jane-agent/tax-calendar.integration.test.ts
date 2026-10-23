import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { TAX_CALENDAR } from "@/config/tax-calendar";
import { setAutopilot } from "@/lib/autopilot";
import { logAudit } from "@/lib/audit";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { setSectorAutopilot } from "@/lib/sector-autopilot";
import { loadSelfEmployed } from "@/lib/self-employed";
import { TAX_PLAN } from "@/config/tax-plan";
import { TaxCalendarError, loadTaxCalendar, payEstimate, runTaxCalendar } from "@/lib/tax-calendar";
import { loadYearPlan } from "@/lib/year-plan";
import { runTaxAutopilot } from "@/lib/tax-autopilot";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { sendToJane } from "./typing";

// Spec step 223 against a real, migrated Postgres: a demo-bank person who freelances (so a
// quarterly plan is needed), and the tax calendar for every month. Estimated payments are
// paid through the stand-in only within the taxes caps; above them it's a tap.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const at = (date: string) => new Date(`${date}T15:00:00Z`);

describe.runIf(url)("the tax calendar against a real database", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no plaid");
      },
    },
  ) as PlaidApi;

  async function freelancer(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    const checking = await client.account.findFirstOrThrow({
      where: { userId: user.id, subtype: "checking" },
    });
    await client.transaction.createMany({
      data: ["2026-02-10", "2026-04-10", "2026-06-10", "2026-08-10", "2026-10-10"].map((d) => ({
        userId: user.id,
        accountId: checking.id,
        source: "plaid" as const,
        date: new Date(`${d}T00:00:00Z`),
        amountCents: -800_000,
        description: "UPWORK ESCROW",
        merchantName: "Upwork",
        pfcDetailed: "INCOME_CONTRACTOR",
      })),
    });
    return user.id;
  }
  const messageFrom = async (userId: string, now: Date, key: string) => {
    const c = taxesSource
      .gather((await loadSnapshot(userId, { client, now }))!, {
        now,
        local: { date: now.toISOString().slice(0, 10), hour: 8 },
        trigger: "open",
      })
      .find((x) => x.dedupeKey.startsWith(key));
    if (!c) return null;
    return client.janeMessage.create({
      data: {
        userId,
        kind: c.kind,
        body: c.body,
        refs: c.refs,
        actions: c.actions,
        dedupeKey: `taxes:${c.dedupeKey}:${crypto.randomUUID()}`,
      },
    });
  };

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
  }, 120_000);

  describe("every month of the calendar", () => {
    let userId = "";
    beforeAll(async () => {
      userId = await freelancer("cal-months");
      await setAutopilot(userId, "safe", { client, now: LINKED });
      // Linking and syncing a sample person is slow on a busy runner: the hook gets as long
      // as the tests do (the default 10s failed at random).
    }, 120_000);
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    it.each(months)("month %i lists its items, each with a status and words", async (month) => {
      const view = await loadTaxCalendar(userId, {
        client,
        now: at(`2026-${String(month).padStart(2, "0")}-10`),
      });
      expect(view.month).toBe(month);
      expect(view.items.map((i) => i.key)).toEqual(TAX_CALENDAR[month]);
      for (const i of view.items) {
        expect(["done", "tap", "waiting", "nothing"], i.key).toContain(i.status);
        expect(i.detail.length, `${month} ${i.key}`).toBeGreaterThan(5);
        expect(i.detail, `${month} ${i.key}`).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      }
      expect(view.months).toHaveLength(12);
    });
  });

  it("pays an estimated payment by itself when it fits the caps, once, and records it", async () => {
    const userId = await freelancer("cal-auto");
    await setAutopilot(userId, "all", { client, now: LINKED });
    await setSectorAutopilot(
      userId,
      "taxes",
      { level: "all", actionCapCents: 5_000_000, monthlyCapCents: 10_000_000 },
      { client, now: LINKED },
    );
    const now = at("2026-09-12");
    const before = await loadTaxCalendar(userId, { client, now });
    expect(before.due).toHaveLength(1);
    expect(before.due[0]).toMatchObject({ dueOn: "2026-09-15", needsTap: null });
    const est = before.items.find((i) => i.key === "estimate")!;
    expect(est).toMatchObject({ status: "waiting" });
    expect(est.detail).toMatch(/^I'll pay \$[\d,.]+ before Sep 15\./);

    // The tax plan's reminder for it, on the deadlines.
    const reminder = await client.deadline.create({
      data: { userId, title: TAX_PLAN.estimated_3.title, dueOn: new Date("2026-09-15T00:00:00Z") },
    });
    const transactions = await client.transaction.count({ where: { userId } });
    const result = await runTaxAutopilot(userId, { client, now });
    expect(result.estimatesPaid).toBe(1);
    const payment = await client.taxPayment.findFirstOrThrow({ where: { userId } });
    expect(payment).toMatchObject({ partner: "demo", via: "autopilot", year: 2026 });
    expect(payment.confirmation).toMatch(/^DEMO-20260915-[0-9A-F]{8}$/);
    expect(payment.cents).toBe(before.due[0].cents);
    // Nothing leaves any account: no transaction was made.
    expect(await client.transaction.count({ where: { userId } })).toBe(transactions);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "system", id: null },
      "tax_payment_made",
      { type: "user", id: userId },
      expect.objectContaining({ via: "autopilot", cents: payment.cents }),
    );
    // The quarterly plan counts it, and it isn't paid twice.
    const se = await loadSelfEmployed(userId, { client, now });
    expect(se.payments.some((p) => p.cents === payment.cents && p.to === "federal")).toBe(true);
    expect((await runTaxAutopilot(userId, { client, now })).estimatesPaid).toBe(0);
    expect(await client.taxPayment.count({ where: { userId } })).toBe(1);
    expect((await loadTaxCalendar(userId, { client, now })).due).toEqual([]);
    expect(
      await client.autopilotAct.count({ where: { userId, sector: "taxes", cents: payment.cents } }),
    ).toBe(1);
    await expect(payEstimate(userId, "2026-09-15", { client, now, via: "tap" })).rejects.toThrow(
      "already paid",
    );
    // Paying it ticks off its reminder, so it never reminds again (docs/feature-audit.md,
    // cluster 12).
    expect(
      (await client.deadline.findUniqueOrThrow({ where: { id: reminder.id } })).doneAt,
    ).not.toBeNull();
    // The year plan counts the payments still planned, as the calendar says them: not $0.
    const january = se.federal.payments.find((p) => p.date === "2027-01-15")!;
    expect(january.cents).toBeGreaterThan(0);
    const plan = (await loadYearPlan(userId, { client, now }))!;
    expect(plan.months.find((m) => m.month === "2027-01")?.targets.taxes).toBe(january.cents);
  });

  it("asks for a tap above the cap, at the ask-first level and over the monthly cap, and pays nothing", async () => {
    const userId = await freelancer("cal-caps");
    const now = at("2026-09-12");
    // Handle the safe stuff, with the default taxes cap ($500 a time): the payment is bigger.
    await setAutopilot(userId, "safe", { client, now: LINKED });
    const over = await loadTaxCalendar(userId, { client, now });
    expect(over.due[0].cents).toBeGreaterThan(50_000);
    expect(over.due[0].needsTap).toBe("action_cap");
    expect(over.items.find((i) => i.key === "estimate")).toMatchObject({ status: "tap" });
    expect((await runTaxAutopilot(userId, { client, now })).estimatesPaid).toBe(0);
    await expect(
      payEstimate(userId, "2026-09-15", { client, now, via: "autopilot" }),
    ).rejects.toThrow("over what I pay by myself");
    expect(await client.taxPayment.count({ where: { userId } })).toBe(0);

    // Ask me first: Jane acts on nothing.
    await setAutopilot(userId, "ask", { client, now: LINKED });
    expect((await loadTaxCalendar(userId, { client, now })).due[0].needsTap).toBe("level");
    expect((await runTaxCalendar(userId, { client, now })).paid).toEqual([]);

    // A per-time cap that fits, but a monthly cap already used up.
    await setAutopilot(userId, "all", { client, now: LINKED });
    await setSectorAutopilot(
      userId,
      "taxes",
      { level: "all", actionCapCents: 5_000_000, monthlyCapCents: 5_000_000 },
      { client, now },
    );
    await client.autopilotAct.create({
      data: { userId, sector: "taxes", cents: 4_999_999, what: "earlier", createdAt: now },
    });
    expect((await loadTaxCalendar(userId, { client, now })).due[0].needsTap).toBe("monthly_cap");
    expect((await runTaxCalendar(userId, { client, now })).needTap).toBe(1);
    expect(await client.taxPayment.count({ where: { userId } })).toBe(0);

    // The message asks, and the person's tap pays the planned amount through the stand-in.
    const message = (await messageFrom(userId, now, "estimate_due:"))!;
    expect(message.body).toMatch(
      /^Your estimated tax payment of \$[\d,.]+ is due Sep 15, 2026\. That would take me over what I may pay in a month on my own, so it's your tap\. Pay it now\?/,
    );
    const done = (await takeChatAction(userId, message.id, "tax.estimate_pay", { client, now }))
      .message;
    expect(done.refs.note).toMatch(
      /^Done: \$[\d,.]+ paid \(confirmation DEMO-20260915-[0-9A-F]{8}\)\. This is the practice payment: no real money moved\.$/,
    );
    expect(await client.taxPayment.findFirstOrThrow({ where: { userId } })).toMatchObject({
      via: "tap",
    });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "tax_payment_made",
      { type: "user", id: userId },
      expect.objectContaining({ via: "tap" }),
    );
  });

  it("pays nothing before its window or for someone with real accounts, and says so", async () => {
    const userId = await freelancer("cal-edge");
    await setAutopilot(userId, "all", { client, now: LINKED });
    await expect(
      payEstimate(userId, "2026-09-15", { client, now: at("2026-09-01"), via: "tap" }),
    ).rejects.toBeInstanceOf(TaxCalendarError);
    const early = await loadTaxCalendar(userId, { client, now: at("2026-09-01") });
    expect(early.due).toEqual([]);
    expect(early.items.find((i) => i.key === "estimate")!.detail).toMatch(
      /^Next: \$[\d,.]+ due Sep 15\./,
    );
    // A real account next to the demo bank: no stand-in, so it's Direct Pay, and no button.
    await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Imported",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 1,
      },
    });
    const real = await loadTaxCalendar(userId, { client, now: at("2026-09-12") });
    expect(real.due[0].needsTap).toBe("no_partner");
    expect(real.items.find((i) => i.key === "estimate")!.detail).toContain(
      "pay it at IRS Direct Pay",
    );
    await expect(
      payEstimate(userId, "2026-09-15", { client, now: at("2026-09-12"), via: "tap" }),
    ).rejects.toThrow("IRS Direct Pay");
    expect(await messageFrom(userId, at("2026-09-12"), "estimate_due:")).toBeNull();
  });

  it("puts January's, June's and December's items where they belong, in the chat and to Claude", async () => {
    const userId = await freelancer("cal-year");
    await setAutopilot(userId, "safe", { client, now: LINKED });
    const jan = await loadTaxCalendar(userId, { client, now: at("2027-01-11") });
    expect(jan.items.map((i) => i.key)).toEqual(["ip_pin", "documents", "estimate"]);
    const june = await loadTaxCalendar(userId, { client, now: at("2026-06-10") });
    expect(june.items.map((i) => i.key)).toEqual(["withholding", "estimate"]);
    expect(june.due[0]).toMatchObject({ dueOn: "2026-06-15" });
    const dec = await loadTaxCalendar(userId, { client, now: at("2026-12-05") });
    expect(dec.items.map((i) => i.key)).toEqual(["year_end"]);

    const { reply } = await sendToJane(userId, "what are my taxes this month", {
      client,
      now: at("2026-09-12"),
    });
    expect(reply.body).toMatch(
      /^Here is your tax calendar for September\.\n• Estimated tax payment \(/,
    );
    const tool = JSON.parse(
      (await runChatTool(userId, "tax_calendar", {}, { client, now: at("2026-09-12") })).content,
    );
    expect(tool.month).toBe("September");
    expect(tool.wholeYear).toHaveLength(12);
    expect(tool.estimatedPaymentsNeedingATap[0]).toMatchObject({
      dueOn: "2026-09-15",
      why: "action_cap",
    });
  });

  it("sends December's year-end moves in one message, and puts them on the deadlines", async () => {
    const userId = await freelancer("cal-yearend");
    const now = at("2026-12-05");
    // Ask me first: one message, with a button.
    await setAutopilot(userId, "ask", { client, now: LINKED });
    const ask = await loadTaxCalendar(userId, { client, now });
    expect(ask.items[0]).toMatchObject({ key: "year_end", status: "tap" });
    const message = (await messageFrom(userId, now, "yearend:"))!;
    expect(message.body).toMatch(/^Here are the tax moves still open before December 31\.\n• /);
    expect(message.body).toContain("Want them on your deadlines?");
    // Each move once: never as a move and again as a count (docs/feature-audit.md, cluster 12).
    if (/Sell at a loss/.test(message.body)) expect(message.body).not.toMatch(/you could harvest/);
    if (/Make this year's gifts/.test(message.body))
      expect(message.body).not.toMatch(/ways to give/);
    expect(message.refs).toMatchObject({ advice: true });
    expect((message.actions as { id: string }[]).map((a) => a.id)).toContain("tax.yearend_plan");
    const before = await client.deadline.count({ where: { userId } });
    const done = (await takeChatAction(userId, message.id, "tax.yearend_plan", { client, now }))
      .message;
    expect(done.refs.note).toMatch(/^Done: \d+ moves? (is|are) on your deadlines\.$/);
    expect(await client.deadline.count({ where: { userId } })).toBeGreaterThan(before);
    const after = await loadTaxCalendar(userId, { client, now });
    expect(after.items[0]).toMatchObject({ status: "done" });

    // Handle the safe stuff: Jane puts them on the deadlines herself, and the message says so.
    const auto = await freelancer("cal-yearend-auto");
    await setAutopilot(auto, "safe", { client, now: LINKED });
    expect((await loadTaxCalendar(auto, { client, now })).items[0]).toMatchObject({
      status: "waiting",
    });
    await runTaxAutopilot(auto, { client, now });
    expect((await loadTaxCalendar(auto, { client, now })).items[0]).toMatchObject({
      status: "done",
    });
    const said = (await messageFrom(auto, now, "yearend:"))!;
    expect(said.body).toContain("The ones with a deadline are already on your deadlines.");
  });
});
