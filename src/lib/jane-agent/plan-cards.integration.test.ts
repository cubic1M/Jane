import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { CompanyStockView } from "@/lib/investments/company-stock";
import type { ValuesView } from "@/lib/investments/values";
import { demoInvestmentSnapshot } from "@/lib/investments/__fixtures__/demo";
import { concentration, diversifyPlan } from "@/planning/company-stock";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/advice-mode", async (actual) => ({
  ...(await actual<typeof import("@/lib/advice-mode")>()),
  adviceMode: vi.fn(async () => true),
}));
// The person's values plan and company stock as they are today, set by each test.
const today = vi.hoisted(() => ({
  values: null as ValuesView | null,
  company: null as CompanyStockView | null,
}));
vi.mock("@/lib/investments/values", async (actual) => ({
  ...(await actual<typeof import("@/lib/investments/values")>()),
  loadValues: vi.fn(async () => today.values),
}));
vi.mock("@/lib/investments/company-stock", async (actual) => ({
  ...(await actual<typeof import("@/lib/investments/company-stock")>()),
  loadCompanyStock: vi.fn(async () => today.company),
}));

import {
  COMPANY_LINK,
  concentrationLine,
  planLine,
  SELL_WORDS,
  sellButton,
} from "./investments/company-copy";
import { VALUES_LINK, valuesButton, valuesPlanLine } from "./investments/values-copy";
import { loadPopupStack } from "./popup-stack";
import type { Snapshot } from "./snapshot";
import { investmentsSource } from "./sources/investments";
import { snoozeButton } from "./sources/source";

// Gate C's full sweep on d1deb506 (debug 3, 11-23), the equity person, daily: 464 times "To match
// your list (no fossil fuels), 2 of your funds would switch…" beside another, and 426 times "Acme
// Corp is $244,156.65, 65% of what you've invested…" beside "$242,410.74…". The values card was
// keyed by each switch's amount, the company card by its plan, whose start is today until a part
// is sold: a new card most days as prices moved.

const url = process.env.TEST_DATABASE_URL;
const ASOF = "2026-11-23";
const NOW = new Date(`${ASOF}T20:00:00Z`);

// A values plan switching one fund, of `cents`, keyed as loadValues keys it: by its amounts.
const values = (cents: number, to = "KUSEX"): ValuesView => {
  const prefs = { excludes: ["fossil_fuels" as const], themes: [] };
  return {
    advice: true,
    prefs,
    note: "n",
    source: "s",
    plan: {
      prefs,
      switches: [
        {
          accountId: "brokerage",
          accountName: "Brokerage",
          taxable: true,
          from: { ticker: "KTSIX", name: "Total US", valueCents: cents, expenseRatioBps: 3 },
          assetClass: "us_stocks",
          legs: [{ ticker: to, name: "Screened US", amountCents: cents }],
          feeDeltaCents: 600,
          gainCents: 0,
        },
      ],
      skipped: [],
      movedCents: cents,
      feeDeltaCents: 600,
      gainCents: 0,
      diversification: [
        { assetClass: "us_stocks", beforeHoldings: 3500, afterHoldings: 3150, keptBps: 9400 },
      ],
      classTotals: {
        us_stocks: { before: 1, after: 1 },
        intl_stocks: { before: 0, after: 0 },
        bonds: { before: 0, after: 0 },
      },
      notes: [],
      key: `amounts-${cents}`,
    } as unknown as NonNullable<ValuesView["plan"]>,
  };
};
// Acme stock at `price` a share, its first part due today, keyed as loadCompanyStock keys its plan:
// by the shares and the day (`start`, today until a part is sold).
const company = (price: number, day = ASOF, lastSale: string | null = null): CompanyStockView => {
  const plan = diversifyPlan({
    quantity: 2_000,
    priceCents: price,
    costBasisCents: 2_000_000,
    lots: [{ date: null, quantity: 2_000 }],
    totalInvestedCents: 30_000_000,
    today: day,
    rates: { longTerm: 0.15, shortTerm: 0.22 },
  });
  return {
    advice: true,
    company: "Acme Corp",
    ticker: "ACME",
    holdings: [],
    grants: [],
    concentration: concentration({
      heldCents: 2_000 * price,
      unvestedCents: 0,
      totalInvestedCents: 30_000_000,
    }),
    plan: {
      ...plan,
      key: `plan-${day}`,
      askKey: `stock-plan:ACME:${lastSale ?? "first"}`,
      accountId: "stock-plan",
      accountName: "Demo Stock Plan",
      nextDue: day,
    },
    rates: { longTerm: 0.15, shortTerm: 0.22, fromEstimate: false },
    demo: true,
  };
};
// Each card as the investments source posts it (./sources/investments.ts).
const valuesCard = (v: ValuesView) => ({
  kind: "decision" as const,
  body: valuesPlanLine({ ...v, advice: true, source: "" }),
  refs: { advice: true, valuesKey: v.plan!.key },
  actions: [valuesButton(), VALUES_LINK, snoozeButton()],
});
const companySellCard = (c: CompanyStockView, day: string) => ({
  kind: "decision" as const,
  body: `${concentrationLine(c)} ${planLine(c, day)} ${SELL_WORDS}`,
  refs: { advice: true, companyPlan: c.plan!.key },
  actions: [sellButton(c), COMPANY_LINK, snoozeButton()],
});
const base = {
  timezone: "America/Los_Angeles",
  asOf: ASOF,
  weekStart: ASOF,
  safeToSpend: null,
  comingUp: [],
  waitingOnYou: [],
  findings: [],
  plan: { items: 0, annualSavingsCents: 0, safeItems: 0 },
  ruleApprovals: [],
  finished: [],
  deadlines: [],
  budgetsOver: [],
  goalsBehind: [],
  urgentAlerts: [],
  budgetProgress: [],
  autopilot: "safe",
  setupProposals: [],
  agentSteps: [],
  assetPrompts: [],
} as unknown as Snapshot;
const keyOf = (prefix: string, v: ValuesView, c: CompanyStockView, asOf = ASOF) =>
  investmentsSource
    .gather(
      {
        ...base,
        asOf,
        investments: demoInvestmentSnapshot({ advice: true, values: v, companyStock: c }),
      },
      {} as never,
    )
    .find((m) => m.dedupeKey.startsWith(prefix))?.dedupeKey;

describe("the values and company stock cards' keys", () => {
  it("are what they ask, not their figures", () => {
    const [v1, v2] = [values(1_000_000), values(1_040_000)];
    const [c1, c2] = [company(12_000), company(12_150, "2026-11-24")];
    expect(keyOf("values:", v1, c1)).toBe(keyOf("values:", v2, c2));
    expect(keyOf("company:sell:", v1, c1)).toBe(keyOf("company:sell:", v2, c2, "2026-11-24"));
  });

  it("change when what they ask does: another fund, the next part after a sale", () => {
    const c = company(12_000);
    expect(keyOf("values:", values(1_000_000), c)).not.toBe(
      keyOf("values:", values(1_000_000, "KESGX"), c),
    );
    const v = values(1_000_000);
    expect(keyOf("company:sell:", v, c)).not.toBe(
      keyOf("company:sell:", v, company(12_000, ASOF, "2026-08-23")),
    );
  });
});

describe.runIf(url)("one values card and one company stock card at a time", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `plan-cards-${crypto.randomUUID()}@example.com` } })
    ).id;
    // Nov 20 to 22: a card of each a day, each with that day's figures.
    for (const [i, day] of ["2026-11-20", "2026-11-21", "2026-11-22"].entries()) {
      const v = valuesCard(values(1_000_000 + i * 20_000));
      const c = companySellCard(company(12_000 + i * 75, day), day);
      await client.janeMessage.createMany({
        data: [
          { ...v, dedupeKey: `investments:values:${i}`, createdAt: new Date(`${day}T16:00:00Z`) },
          {
            ...c,
            dedupeKey: `investments:company:sell:${i}`,
            createdAt: new Date(`${day}T16:00:01Z`),
          },
        ].map((m) => ({ ...m, userId })),
      });
    }
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("shows the newest of each, said with today's figures, and puts the rest away", async () => {
    today.values = values(1_080_000);
    today.company = company(12_300);
    const shown = (await loadPopupStack(userId, { client, now: NOW })).map((m) => m.body);
    expect(shown.filter((b) => b.startsWith("To match your list"))).toEqual([
      valuesCard(today.values).body,
    ]);
    expect(shown.filter((b) => b.startsWith("Acme Corp is"))).toEqual([
      companySellCard(today.company, ASOF).body,
    ]);
    const rows = await client.janeMessage.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    expect(rows.filter((r) => r.status === "open")).toHaveLength(2);
    // Stored as shown: a tap checks today's plan key (src/lib/investments/values.ts, company-stock.ts).
    expect(rows[0].refs).toMatchObject({ companyPlan: `plan-${ASOF}` });
    expect(rows[1].refs).toMatchObject({ valuesKey: "amounts-1080000" });
  });
});
