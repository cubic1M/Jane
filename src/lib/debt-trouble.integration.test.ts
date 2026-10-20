import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { COUNSEL_POINTER, DEBT_FACTS } from "@/config/debt-trouble";
import { checkGuardrails } from "@/lib/guardrails";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { debtTroubleSource } from "@/lib/jane-agent/sources/debt-trouble";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadDebtTrouble } from "./debt-trouble";

// Spec step 229 against a real, migrated Postgres, on the demo bank (a mortgage, car, student
// loan and cards against about $4,900 a month of pay): the share of income going to debt, the
// hardship program to ask each lender for, a debt management plan sketched from the person's
// own cards, and the reviewed facts, which the guardrails let through word for word.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("when debt is too much against a real database", { timeout: 30_000 }, () => {
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
  const opts = (now = LINKED) => ({ client, now });

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `trouble-${crypto.randomUUID()}@example.com` },
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

  it("works out the share of income from the person's own payments and pay", async () => {
    const t = await loadDebtTrouble(userId, opts());
    expect(t.available).toBe(true);
    expect(t.incomeCents).toBeGreaterThan(400_000);
    expect(t.monthlyPaymentsCents).toBeGreaterThan(300_000);
    expect(t.share).toBeCloseTo(t.monthlyPaymentsCents / t.incomeCents!, 5);
    expect(t.over).toBe(true);
    expect(t.debts.map((d) => d.kind)).toContain("mortgage");
    expect(t.dmp!.cardBalanceCents).toBeGreaterThan(0);
  });

  it("brings it up once a quarter, as a heads-up with no advice", async () => {
    const snapshot = (await loadSnapshot(userId, opts()))!;
    const [m] = debtTroubleSource.gather(snapshot, context);
    expect(m).toMatchObject({ kind: "heads_up", dedupeKey: "trouble:2026q4" });
    expect(m.body).toMatch(
      /^Your debt payments are \$[\d,.]+ a month, \d+% of your income, over the 40% mark/,
    );
    const next = debtTroubleSource.gather(snapshot, {
      ...context,
      local: { date: "2027-01-05", hour: 8 },
    });
    expect(next[0].dedupeKey).toBe("trouble:2027q1");
  });

  it("lays out the options in chat as facts, and the guardrails accept every word", async () => {
    const { reply } = await sendToJane(userId, "I have too much debt, what are my options", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(/^Your debt payments are \$[\d,.]+ a month, \d+% of your/);
    expect(reply.body).toContain("Hardship programs, by lender:");
    expect(reply.body).toContain("A debt management plan puts your card payments");
    expect(reply.body).toContain("nfcc.org");
    for (const f of [...DEBT_FACTS.settlement, ...DEBT_FACTS.bankruptcy, ...DEBT_FACTS.taxes]) {
      expect(reply.body).toContain(f.text);
    }
    expect(reply.body).toContain(COUNSEL_POINTER);
    for (const profile of ["standard", "demo_advice"] as const) {
      const shown = (reply.body.match(/\$[\d,]+(?:\.\d{2})?/g) ?? []).map((s) =>
        Math.round(Number(s.replace(/[$,]/g, "")) * 100),
      );
      expect(checkGuardrails(reply.body, shown, undefined, profile), profile).toEqual({ ok: true });
    }
    // It never tells the person what to do about bankruptcy or settlement.
    expect(reply.body).not.toMatch(/you should|i recommend|file for/i);
  });

  it("gives Claude the same figures and facts, with the instruction not to advise", async () => {
    const tool = await runChatTool(userId, "debt_trouble", {}, opts());
    const out = JSON.parse(tool.content);
    expect(out.overTheMarkWhereJaneBringsItUp).toBe(true);
    expect(out.debtManagementPlanSketch.assumptionNotAnOffer).toBe(true);
    expect(out.reviewedFacts.map((f: { fact: string }) => f.fact)).toEqual(
      [...DEBT_FACTS.settlement, ...DEBT_FACTS.bankruptcy, ...DEBT_FACTS.taxes].map((f) => f.text),
    );
    expect(out.forLegalQuestions).toBe(COUNSEL_POINTER);
    expect(tool.cents).toContain((await loadDebtTrouble(userId, opts())).monthlyPaymentsCents);
  });

  it("has nothing for someone without a debt", async () => {
    const user = await client.user.create({
      data: { email: `trouble-none-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    expect((await loadDebtTrouble(user.id, opts())).available).toBe(false);
    const { reply } = await sendToJane(user.id, "should I file for bankruptcy?", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(/^I don't see a debt with a balance/);
  });
});
