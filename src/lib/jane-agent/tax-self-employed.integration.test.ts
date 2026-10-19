import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { setAutopilot } from "@/lib/autopilot";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadSelfEmployed, saveHomeOffice } from "@/lib/self-employed";
import { runTaxAutopilot, setAsideGoalName } from "@/lib/tax-autopilot";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { loadTaxTags } from "@/lib/tax-organizer";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { parseActions } from "./types";
import { sendToJane } from "./typing";

// Spec step 123 against a real, migrated Postgres: a demo-bank person who also freelances
// (Upwork payments added to the demo checking account). The quarterly amounts add up to the
// estimate, the reminder comes before the due date with the amount, each payment says what
// to set aside, Jane starts the set-aside goal by herself at Handle the safe stuff, and the
// helpers (home office, miles, payments made elsewhere) feed the estimate.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;

describe.runIf(url)("freelancers' taxes against a real database", () => {
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
  let tick = 0;
  const later = () => new Date(LINKED.getTime() + ++tick * MINUTE);
  const gather = async (now: Date, date: string) =>
    taxesSource.gather((await loadSnapshot(userId, { client, now }))!, {
      now,
      local: { date, hour: 8 },
      trigger: "open",
    });
  async function post(candidate: {
    kind: string;
    body: string;
    refs: object;
    actions: object[];
    dedupeKey: string;
  }) {
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

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `tax-freelance-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    created.push(userId);
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    const checking = await client.account.findFirstOrThrow({
      where: { userId, subtype: "checking" },
    });
    const row = (date: string, amountCents: number, description: string, pfcDetailed: string) => ({
      userId,
      accountId: checking.id,
      source: "plaid" as const,
      date: new Date(`${date}T00:00:00Z`),
      amountCents,
      description,
      merchantName: description === "UPWORK ESCROW" ? "Upwork" : "Staples",
      pfcDetailed,
    });
    await client.transaction.createMany({
      data: [
        ...["2026-02-10", "2026-04-10", "2026-06-10", "2026-08-10", "2026-10-10"].map((d) =>
          row(d, -800_000, "UPWORK ESCROW", "INCOME_CONTRACTOR"),
        ),
        row("2026-09-02", 12_000, "STAPLES 0042", "GENERAL_MERCHANDISE_OFFICE_SUPPLIES"),
      ],
    });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("the quarterly amounts, withholding and payments add up to the estimate", async () => {
    const view = await loadSelfEmployed(userId, { client, now: LINKED });
    expect(view).toMatchObject({ active: true, advice: true, freelanceInCents: 4_000_000 });
    expect(view.setAsideRate).toBeGreaterThan(0.2);
    expect(view.federal.needed).toBe(true);
    expect(view.federal.payments.map((p) => p.date)).toEqual(["2027-01-15"]);
    const e = view.estimate;
    const sum = view.federal.payments.reduce((s, p) => s + p.cents, 0);
    expect(sum + e.pay.projected.federalWithheldCents + e.input.federalEstimatedPaidCents).toBe(
      e.estimate.totalTaxCents,
    );
  });

  it("suggests office supplies as a business expense, and asks", async () => {
    const tags = await loadTaxTags(userId, 2026, { client });
    expect(tags.checks.some((c) => c.payee === "Staples" && c.tag === "business")).toBe(true);
  });

  it("says what to set aside from each new payment, and reminds before the due date", async () => {
    const now = new Date("2026-10-18T15:00:00Z");
    const recent = (await gather(now, "2026-10-18")).find((c) =>
      c.dedupeKey.startsWith("setaside:"),
    )!;
    expect(recent.body).toMatch(
      /^Upwork paid you \$8,000\.00\. Set aside about \$[\d,]+ \(\d+%\) for its taxes, by my estimate\./,
    );
    expect(parseActions(recent.actions)[0].id).toBe("goal.start");
    // No reminder 89 days before; one 12 days before, with the amount.
    expect((await gather(now, "2026-10-18")).some((c) => c.dedupeKey.startsWith("quarter:"))).toBe(
      false,
    );
    const january = new Date("2027-01-03T16:00:00Z");
    const q = (await gather(january, "2027-01-03")).find(
      (c) => c.dedupeKey === "quarter:2027-01-15",
    )!;
    expect(q.body).toMatch(/^Estimated tax is due Jan 15: about \$[\d,]+ federal/);
    const message = await post(q);
    const before = (await loadTaxEstimate(userId, { client, now: january })).estimate.paidCents;
    const after = (
      await takeChatAction(userId, message.id, "tax.quarter_paid", { client, now: january })
    ).message;
    expect(after.refs.note).toMatch(/^Noted: \$[\d,.]+ federal/);
    expect(
      (await loadTaxEstimate(userId, { client, now: january })).estimate.paidCents,
    ).toBeGreaterThan(before);
  });

  it("starts the set-aside goal by itself at Handle the safe stuff, never at Ask me first", async () => {
    expect(await runTaxAutopilot(userId, { client, now: LINKED })).toEqual({ goalStarted: false });
    await setAutopilot(userId, "safe", { client, now: LINKED });
    expect(await runTaxAutopilot(userId, { client, now: LINKED })).toEqual({ goalStarted: true });
    expect(
      await client.savingsGoal.count({ where: { userId, name: setAsideGoalName(2026) } }),
    ).toBe(1);
    // Once.
    expect(await runTaxAutopilot(userId, { client, now: LINKED })).toEqual({ goalStarted: false });
    await setAutopilot(userId, "ask", { client, now: LINKED });
  });

  it("the home office and business miles come off freelance income", async () => {
    const before = (await loadTaxEstimate(userId, { client, now: LINKED })).input.income
      .selfEmploymentCents;
    await saveHomeOffice(userId, 150, { client, via: "page" });
    const { reply } = await sendToJane(userId, "I drove 1,000 business miles", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(
      /^Want me to add 1,000 business miles to this year's\? At the 2026 rate that's about \$725/,
    );
    const added = (
      await takeChatAction(userId, reply.id, "tax.miles_add", { client, now: later() })
    ).message;
    expect(added.refs.note).toBe("Added. That's 1,000 business miles this year.");
    const after = (await loadTaxEstimate(userId, { client, now: LINKED })).input.income
      .selfEmploymentCents;
    expect(after).toBeLessThan(before - 75_000);
  });

  it("answers quarterly tax questions and gives Claude the plan as estimates", async () => {
    const { reply } = await sendToJane(userId, "when are my quarterly taxes due", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(/^Estimated tax is due Jan 15/);
    const tool = JSON.parse(
      (await runChatTool(userId, "tax_self_employed", {}, { client, now: LINKED })).content,
    );
    expect(tool).toMatchObject({
      freelance: true,
      isAnEstimate: true,
      homeOffice: { squareFeet: 150 },
    });
    expect(tool.demoAdvice.estimatedPayments[0].due).toBe("2027-01-15");
  });
});
