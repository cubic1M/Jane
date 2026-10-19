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
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { TaxProfileError, savePayStub, saveTaxAnswers } from "@/lib/tax-profile";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { parseActions } from "./types";
import { sendToJane } from "./typing";

// Spec step 120 against a real, migrated Postgres: the demo bank's pay stubs give a refund
// estimate; the profile changes it; someone without pay stubs gets the tax but no refund
// until they type their pay stub in; estimated payments count; the chat says it, always as
// an estimate.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;

describe.runIf(url)("the tax estimate against a real database", () => {
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
  // Someone with a real-looking checking account: paychecks, a freelance payment and an
  // estimated tax payment.
  async function realPerson(prefix: string) {
    const userId = await person(prefix);
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    const row = (date: string, amountCents: number, description: string, pfcDetailed: string) => ({
      userId,
      accountId: account.id,
      source: "csv" as const,
      date: new Date(`${date}T00:00:00Z`),
      amountCents,
      description,
      pfcDetailed,
    });
    await client.transaction.createMany({
      data: [
        ...Array.from({ length: 19 }, (_, i) =>
          row(
            new Date(Date.UTC(2026, 0, 2) + i * 14 * 86_400_000).toISOString().slice(0, 10),
            -300_000,
            "GLOBEX PAYROLL",
            "INCOME_SALARY",
          ),
        ),
        row("2026-05-01", -500_000, "UPWORK ESCROW", "INCOME_CONTRACTOR"),
        row("2026-06-15", 80_000, "IRS USATAXPYMT", "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT"),
      ],
    });
    return userId;
  }

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    demoId = await person("tax-estimate-demo");
    const { itemId } = await linkDemoBank(demoId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("estimates the demo bank's year from its stand-in pay stubs", async () => {
    const view = await loadTaxEstimate(demoId, { client, now: LINKED });
    expect(view.year).toBe(2026);
    expect(view.pay).toMatchObject({
      source: "demo",
      perYear: 24,
      employers: ["ACME CORP PAYROLL"],
    });
    // 24 paychecks of $3,950 less $237 of 401(k) and $145 of health.
    expect(view.pay.projected.wagesCents).toBe(24 * (395_000 - 23_700 - 14_500));
    expect(view.withholdingKnown).toBe(true);
    expect(view.estimate.filingStatus).toBe("single");
    expect(view.estimate.refundCents).toBeGreaterThan(300_000);
    expect(view.estimate.state).toMatchObject({ code: "CA", kind: "brackets", rough: true });
    expect(view.assumptions).toContain(
      "You haven't told me how you file, so I've estimated as single.",
    );
  });

  it("follows the profile: married with two children owes less", async () => {
    const single = (await loadTaxEstimate(demoId, { client, now: LINKED })).estimate;
    await saveTaxAnswers(
      demoId,
      [
        { field: "filingStatus", value: "married_joint" },
        { field: "dependants", childrenUnder17: 2, otherDependants: 0 },
      ],
      { client, via: "page" },
    );
    const married = await loadTaxEstimate(demoId, { client, now: LINKED });
    expect(married.estimate.credits.childTaxCreditCents).toBeGreaterThan(0);
    expect(married.estimate.totalTaxCents).toBeLessThan(single.totalTaxCents);
    expect(married.assumptions.some((a) => a.includes("how you file"))).toBe(false);
  });

  it("without pay stubs: the tax from take-home pay, no refund until pay stub figures", async () => {
    const userId = await realPerson("tax-estimate-real");
    let view = await loadTaxEstimate(userId, { client, now: LINKED });
    expect(view.pay.source).toBe("none");
    expect(view.withholdingKnown).toBe(false);
    expect(view.assumptions.join(" ")).toContain("Add your pay stub figures");
    expect(view.estimate.selfEmploymentTaxCents).toBeGreaterThan(0);
    expect(view.estimate.paidCents).toBe(80_000);

    await savePayStub(
      userId,
      {
        asOf: "2026-09-25",
        grossCents: 7_600_000,
        federalCents: 950_000,
        stateCents: 0,
        retirementCents: 380_000,
        pretaxCents: 120_000,
      },
      { client, now: LINKED, via: "page" },
    );
    view = await loadTaxEstimate(userId, { client, now: LINKED });
    expect(view.pay.source).toBe("pay_stub");
    expect(view.withholdingKnown).toBe(true);
    expect(view.pay.soFar.wagesCents).toBe(7_100_000);
    expect(view.estimate.paidCents).toBe(view.pay.projected.federalWithheldCents + 80_000);

    await expect(
      savePayStub(
        userId,
        {
          asOf: "2026-12-31",
          grossCents: 1,
          federalCents: 0,
          stateCents: 0,
          retirementCents: 0,
          pretaxCents: 0,
        },
        { client, now: LINKED, via: "page" },
      ),
    ).rejects.toBeInstanceOf(TaxProfileError);
    await expect(
      savePayStub(
        userId,
        {
          asOf: "2026-09-25",
          grossCents: 100,
          federalCents: 200,
          stateCents: 0,
          retirementCents: 0,
          pretaxCents: 0,
        },
        { client, now: LINKED, via: "page" },
      ),
    ).rejects.toThrow("more than the gross pay");
    await savePayStub(userId, null, { client, now: LINKED, via: "page" });
    expect((await loadTaxEstimate(userId, { client, now: LINKED })).pay.source).toBe("none");
  });

  it("brings the estimate up once at Ask me first, and again when it moves at Handle the safe stuff", async () => {
    const context = {
      now: LINKED,
      local: { date: "2026-10-18", hour: 8 },
      trigger: "open" as const,
    };
    const ask = taxesSource.gather((await loadSnapshot(demoId, { client, now: LINKED }))!, context);
    const once = ask.find((c) => c.dedupeKey.startsWith("estimate:"))!;
    expect(once.dedupeKey).toBe("estimate:2026");
    expect(once.body).toMatch(
      /^My estimate for your 2026 taxes: federal, a refund of about \$[\d,]+\./,
    );
    expect(once.body).toContain("I update it after every sync.");

    await setAutopilot(demoId, "safe", { client, now: LINKED });
    const safe = taxesSource.gather(
      (await loadSnapshot(demoId, { client, now: LINKED }))!,
      context,
    );
    expect(safe.find((c) => c.dedupeKey.startsWith("estimate:"))!.dedupeKey).toMatch(
      /^estimate:2026:\d+$/,
    );
    await setAutopilot(demoId, "ask", { client, now: LINKED });
  });

  it("answers how much will I owe and what's my bracket, always as an estimate", async () => {
    const owe = await sendToJane(demoId, "how much will I owe in taxes", { client, now: later() });
    expect(owe.reply.body).toMatch(/^My estimate for your 2026 taxes: /);
    expect(parseActions(owe.reply.actions).map((a) => a.label)).toEqual(["See the estimate"]);
    const bracket = await sendToJane(demoId, "what's my tax bracket", { client, now: later() });
    expect(bracket.reply.body).toMatch(/^Your top federal rate is about \d+%/);
  });

  it("gives Claude the estimate, marked as one, with figures recorded", async () => {
    const result = await runChatTool(demoId, "tax_estimate", {}, { client, now: LINKED });
    const data = JSON.parse(result.content);
    expect(data).toMatchObject({
      year: 2026,
      isAnEstimate: true,
      payFrom: "demo",
      withholdingKnown: true,
    });
    expect(data.federal.filingStatus).toBe("Married filing jointly");
    expect(result.cents.length).toBeGreaterThan(5);
  });
});
