import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { FIGURE_IDS } from "@/config/figures";
import { loadDetectionInput } from "@/detection/engine";
import { correctCategory } from "@/lib/categories";
import { healthFor, healthInput } from "@/lib/health-score";
import { homeSummary } from "@/lib/home";
import { answerByRules } from "@/lib/jane-agent/answer";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { parseIntent } from "@/lib/jane-agent/intents";
import { savePreference } from "@/lib/jane-agent/preferences";
import { formatCents } from "@/lib/money";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadBaseline } from "@/lib/what-if";
import { explainFigure } from "./figures";

// Spec step 239 against a real, migrated Postgres, with the demo bank: each headline figure
// has its working, from the same loaders as the page that shows it; a category the person
// corrects changes the working, the health inputs and every page that used it; income they
// correct flows to every sector that works from income.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-16T15:00:00Z");

describe.runIf(url)("every figure explained and correctable", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  const created: string[] = [];
  const api = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no Plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `figures-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    created.push(userId);
    const { itemId } = await linkDemoBank(userId, { client, now: NOW });
    await syncItem(itemId, { client, api, now: NOW });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("gives every headline figure its working, matching the page that shows it", async () => {
    for (const id of FIGURE_IDS) {
      const working = (await explainFigure(userId, id, { client, now: NOW }))!;
      expect(working, id).not.toBeNull();
      expect(working.rows.length, id).toBeGreaterThan(0);
      expect(working.asOf).toBe("2026-10-16");
      expect(working.summary.length).toBeGreaterThan(20);
    }
    const safe = (await homeSummary(userId, { client, now: NOW }))!.safeToSpend!;
    expect((await explainFigure(userId, "safe_to_spend", { client, now: NOW }))!.value).toBe(
      formatCents(safe.safeCents),
    );
    const health = (await healthFor(userId, { client, now: NOW }))!;
    expect((await explainFigure(userId, "health_score", { client, now: NOW }))!.value).toBe(
      `${health.score} out of 100`,
    );
    const input = await loadDetectionInput(userId, { client, now: NOW });
    const h = await healthInput(userId, input, { client, now: NOW });
    expect((await explainFigure(userId, "monthly_spending", { client, now: NOW }))!.value).toBe(
      formatCents(h.monthlySpendingCents!),
    );
  });

  // Debugger 11-02: "How I got this" showed "categories: TRANSFER_OUT, TRANSFER_IN,
  // LOAN_DISBURSEMENTS", "in HOME_IMPROVEMENT, MEDICAL…", the spending rules on the income page, and
  // dates like "due before 2026-11-03". The words people read have no codes and no ISO dates.
  it("explains each figure in words, with no category codes or ISO dates", async () => {
    const CODE = /\b[A-Z]{3,}_[A-Z_]+\b/;
    const ISO = /\b\d{4}-\d{2}-\d{2}\b/;
    for (const id of FIGURE_IDS) {
      const w = (await explainFigure(userId, id, { client, now: NOW }))!;
      const words = [
        w.summary,
        ...w.rows.flatMap((r) => [r.label, r.value, r.note ?? ""]),
        ...w.rules.flatMap((r) => [r.label, r.value]),
      ];
      for (const text of words) {
        expect(text, `${id}: ${text}`).not.toMatch(CODE);
        expect(text, `${id}: ${text}`).not.toMatch(ISO);
      }
    }
    const income = (await explainFigure(userId, "monthly_income", { client, now: NOW }))!;
    expect(income.rules.map((r) => r.label).join(" ")).not.toMatch(/spending/i);
  });

  it("a category fixed on a transaction changes the working and every figure that used it", async () => {
    const before = (await explainFigure(userId, "monthly_spending", { client, now: NOW }))!;
    const biggest = before.transactions[0];
    expect(biggest).toBeDefined();
    const inputBefore = await loadDetectionInput(userId, { client, now: NOW });
    const spendBefore = (await healthInput(userId, inputBefore, { client, now: NOW }))
      .monthlySpendingCents!;
    // It was money moved to another of their accounts, not spending.
    await correctCategory(userId, biggest.id, "TRANSFER_OUT_ACCOUNT_TRANSFER", {
      forMerchant: false,
      client,
    } as never);
    const after = (await explainFigure(userId, "monthly_spending", { client, now: NOW }))!;
    expect(after.transactions.map((t) => t.id)).not.toContain(biggest.id);
    const inputAfter = await loadDetectionInput(userId, { client, now: NOW });
    const spendAfter = (await healthInput(userId, inputAfter, { client, now: NOW }))
      .monthlySpendingCents!;
    expect(spendAfter).toBeLessThan(spendBefore);
    // The same correction flows to the what-if baseline, which reads the same spending.
    expect((await loadBaseline(userId, { client, now: NOW }))!.monthlySpendingCents).toBe(
      spendAfter,
    );
    expect(after.value).toBe(formatCents(spendAfter));
  });

  it("income the person corrects flows to every sector that works from income", async () => {
    const before = (await explainFigure(userId, "monthly_income", { client, now: NOW }))!;
    expect(before.summary).not.toMatch(/You told me/);
    await savePreference(
      userId,
      {
        kind: "fact",
        key: "income",
        value: { monthlyCents: 777_700 },
        label: "Income is $7,777.00 a month",
      },
      { client },
    );
    const after = (await explainFigure(userId, "monthly_income", { client, now: NOW }))!;
    expect(after.value).toBe("$7,777.00");
    expect(after.summary).toMatch(/^You told me you earn \$7,777\.00 a month/);
    const input = await loadDetectionInput(userId, { client, now: NOW });
    expect((await healthInput(userId, input, { client, now: NOW })).monthlyIncomeCents).toBe(
      777_700,
    );
    expect((await loadBaseline(userId, { client, now: NOW }))!.monthlyIncomeCents).toBe(777_700);
  });

  it("answers 'how did you get that' in the chat and for Claude", async () => {
    const intent = parseIntent("how did you get my safe to spend", "2026-10-16");
    expect(intent).toEqual({ kind: "figure_how", figure: "safe_to_spend" });
    const reply = await answerByRules(userId, intent, { client, now: NOW });
    expect(reply?.body).toMatch(/^Safe to spend is \$/);
    expect(reply?.actions[0]).toMatchObject({ href: "/figures/safe_to_spend" });
    const which = await answerByRules(
      userId,
      parseIntent("how did you get that number", "2026-10-16"),
      { client, now: NOW },
    );
    expect(which?.body).toMatch(/^Which figure\?/);
    const tool = JSON.parse(
      (await runChatTool(userId, "explain_figure", { figure: "net_worth" }, { client, now: NOW }))
        .content,
    );
    expect(tool.page).toBe("/figures/net_worth");
    expect(tool.rows.length).toBeGreaterThan(0);
  });
});
