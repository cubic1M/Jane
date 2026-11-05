import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/advice-mode", async (original) => {
  const real = await original<typeof import("@/lib/advice-mode")>();
  return { ...real, adviceMode: vi.fn(real.adviceMode) };
});

import { adviceMode } from "@/lib/advice-mode";
import { logAudit } from "@/lib/audit";
import { explainFigure } from "@/lib/figures";
import { homeSummary } from "@/lib/home";
import { heroView } from "@/lib/hub/view";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { detectFor, scanSuggestions } from "@/lib/suggestions";
import { formatWholeDollars } from "@/lib/money";
import { payerKeyOf } from "@/planning/tax-corrections";
import { TaxCorrectionError, addTaxCorrection, removeTaxCorrection } from "./tax-corrections";
import { loadTaxSetAside } from "./tax-set-aside";

// The tax left to cover against a real, migrated Postgres: it lowers Safe to spend wherever that's
// quoted, a correction moves it and survives a re-scan, and an undo puts it back. Made-up people.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-04T18:00:00Z");
const day = (d: string) => new Date(`${d}T00:00:00Z`);
const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"];

describe.runIf(url)("the tax left to cover", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];

  const row = (
    userId: string,
    accountId: string,
    date: string,
    cents: number,
    description: string,
    pfcDetailed: string,
  ) => ({
    userId,
    accountId,
    source: "csv" as const,
    dedupeKey: crypto.randomUUID(),
    date: day(date),
    amountCents: cents,
    description,
    merchantName: description,
    pfcPrimary: pfcDetailed.startsWith("INCOME") ? "INCOME" : "GOVERNMENT_AND_NON_PROFIT",
    pfcDetailed,
    categorySource: "rule" as const,
  });

  // A freelancer, or with "salary" a person paid by an employer, with a real (not demo) account.
  async function person(kind: "freelance" | "salary" = "freelance") {
    const user = await client.user.create({
      data: { email: `tax-aside-${crypto.randomUUID()}@example.com`, autopilot: "ask" },
    });
    created.push(user.id);
    const checking = await client.account.create({
      data: {
        userId: user.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 6_000_000,
      },
    });
    await client.taxProfile.create({
      data: {
        userId: user.id,
        filingStatus: "single",
        state: "TX",
        childrenUnder17: 0,
        otherDependants: 0,
        answered: ["filingStatus", "state", "dependants"],
      },
    });
    await client.transaction.createMany({
      data:
        kind === "freelance"
          ? [
              ...MONTHS.map((m) =>
                row(
                  user.id,
                  checking.id,
                  `2026-${m}-15`,
                  -500_000,
                  "BRIGHTLEAF MEDIA",
                  "INCOME_CONTRACTOR",
                ),
              ),
              row(user.id, checking.id, "2026-03-02", -1_000_000, "AUNT ROSE", "INCOME_CONTRACTOR"),
            ]
          : MONTHS.map((m) =>
              row(
                user.id,
                checking.id,
                `2026-${m}-15`,
                -500_000,
                "NORTHWIND PAYROLL",
                "INCOME_SALARY",
              ),
            ),
    });
    return { userId: user.id, checkingId: checking.id };
  }

  const options = () => ({ client, now: NOW });
  const hold = async (userId: string) => (await loadTaxSetAside(userId, options())).holdCents;
  const safe = async (userId: string) => (await homeSummary(userId, options()))!.safeToSpend!;

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("is one figure wherever Safe to spend is quoted", async () => {
    const { userId } = await person();
    const aside = await loadTaxSetAside(userId, options());
    expect(aside.status).toBe("needed");
    expect(aside.holdCents).toBeGreaterThan(0);
    const s = await safe(userId);
    expect(s.taxHeldCents).toBe(aside.holdCents);
    expect(s.safeCents).toBe(
      s.balanceCents -
        s.billsCents -
        s.budgetsLeftCents -
        s.goalsCents -
        s.setAsideCents -
        aside.holdCents,
    );

    // Home: a named line, in both workings.
    const hero = heroView({
      asOf: "2026-11-04",
      safe: s,
      netWorth: null,
      foundCents: 0,
      savedCents: 0,
    }).safe!;
    for (const lines of [hero.why, hero.steps]) {
      const line = lines.find((l) => l.label === "Tax not yet withheld or paid");
      expect(line?.cents).toBe(aside.holdCents);
      expect(line?.note).toContain("estimate");
      expect(line?.note).toContain("none kept apart");
    }

    // /figures/safe_to_spend.
    const working = await explainFigure(userId, "safe_to_spend", options());
    expect(working?.value).toBe(
      new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
        s.safeCents / 100,
      ),
    );
    const figureRow = working?.rows.find((r) => r.label === "Tax not yet withheld or paid");
    expect(figureRow?.value).toContain((aside.holdCents / 100).toFixed(2).slice(-5));

    // The chat.
    const { content } = await runChatTool(userId, "safe_to_spend", {}, options());
    expect(JSON.parse(content).heldBackForTaxNotYetPaid).toBeDefined();
    const estimate = JSON.parse((await runChatTool(userId, "tax_estimate", {}, options())).content);
    expect(estimate.notYetWithheldOrPaid).toBe(JSON.parse(content).heldBackForTaxNotYetPaid);
  });

  it("'that isn't income' lowers it, raises Safe to spend, is audited, and undoes", async () => {
    const { userId } = await person();
    const before = await hold(userId);
    const safeBefore = (await safe(userId)).safeCents;
    await addTaxCorrection(
      userId,
      { kind: "not_income", payerKey: payerKeyOf("AUNT ROSE") },
      { ...options(), via: "page" },
    );
    const after = await hold(userId);
    expect(after).toBeLessThan(before);
    expect((await safe(userId)).safeCents).toBe(safeBefore + before - after);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "tax_correction_added",
      { type: "user", id: userId },
      expect.objectContaining({ kind: "not_income" }),
    );

    const { estimateView } = await loadTaxSetAside(userId, options());
    expect(estimateView.soFar.payers.map((p) => p.label)).toEqual(["BRIGHTLEAF MEDIA"]);
    const [fix] = estimateView.corrections;
    expect(fix?.label).toBe("AUNT ROSE");

    await removeTaxCorrection(userId, fix!.id, { ...options(), via: "page" });
    expect(await hold(userId)).toBe(before);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "tax_correction_removed",
      { type: "user", id: userId },
      expect.objectContaining({ kind: "not_income" }),
    );
  });

  it("a correction survives a re-sync, a re-scan and that payer's later deposits", async () => {
    const { userId, checkingId } = await person();
    await addTaxCorrection(
      userId,
      { kind: "not_income", payerKey: payerKeyOf("AUNT ROSE") },
      { ...options(), via: "page" },
    );
    const corrected = await hold(userId);

    // The rows come again with new ids, as a re-import does, and the nightly scan runs.
    const rows = await client.transaction.findMany({ where: { userId } });
    await client.transaction.deleteMany({ where: { userId } });
    await client.transaction.createMany({
      data: rows.map((r) =>
        row(
          userId,
          checkingId,
          r.date.toISOString().slice(0, 10),
          r.amountCents,
          r.description,
          r.pfcDetailed!,
        ),
      ),
    });
    await scanSuggestions(userId, options());
    expect(await hold(userId)).toBe(corrected);

    // Another deposit from them later on isn't income either.
    await client.transaction.create({
      data: row(userId, checkingId, "2026-10-30", -2_000_000, "AUNT ROSE", "INCOME_CONTRACTOR"),
    });
    expect(await hold(userId)).toBe(corrected);
  });

  it.each([
    ["deduction", { kind: "deduction", cents: 500_000 }],
    ["cost of work", { kind: "business_cost", cents: 500_000 }],
    ["payment", { kind: "paid", cents: 200_000, paidTo: "federal" }],
    ["state payment", { kind: "paid", cents: 200_000, paidTo: "state" }],
    ["lower income", { kind: "self_employed", cents: 3_000_000 }],
    ["kept apart", { kind: "kept_apart", cents: 200_000 }],
  ] as const)("a %s lowers what's held back", async (_name, correction) => {
    const { userId } = await person();
    const before = await hold(userId);
    await addTaxCorrection(userId, correction, { ...options(), via: "page" });
    expect(await hold(userId)).toBeLessThan(before);
    expect((await safe(userId)).taxHeldCents).toBe(await hold(userId));
  });

  it("one number per year: giving it again replaces it", async () => {
    const { userId } = await person();
    await addTaxCorrection(
      userId,
      { kind: "kept_apart", cents: 100_000 },
      { ...options(), via: "page" },
    );
    await addTaxCorrection(
      userId,
      { kind: "kept_apart", cents: 300_000 },
      { ...options(), via: "page" },
    );
    const rows = await client.taxCorrection.findMany({ where: { userId } });
    expect(rows.map((r) => r.cents)).toEqual([300_000]);
  });

  it("refuses a bad amount and a payer that isn't theirs", async () => {
    const { userId } = await person();
    const { userId: other } = await person();
    await expect(
      addTaxCorrection(userId, { kind: "deduction", cents: -5 }, { ...options(), via: "page" }),
    ).rejects.toThrow(TaxCorrectionError);
    await expect(
      addTaxCorrection(
        userId,
        { kind: "not_income", payerKey: "someone made up" },
        { ...options(), via: "page" },
      ),
    ).rejects.toThrow(TaxCorrectionError);
    expect(await client.taxCorrection.count({ where: { userId: { in: [userId, other] } } })).toBe(
      0,
    );
  });

  it("is scoped: nobody can undo or read another person's correction", async () => {
    const { userId } = await person();
    const { userId: other } = await person();
    await addTaxCorrection(
      userId,
      { kind: "deduction", cents: 500_000, label: "A marked desk" },
      { ...options(), via: "page" },
    );
    const [mine] = await client.taxCorrection.findMany({ where: { userId } });
    await expect(
      removeTaxCorrection(other, mine!.id, { ...options(), via: "page" }),
    ).rejects.toThrow(TaxCorrectionError);
    expect(await client.taxCorrection.count({ where: { userId } })).toBe(1);
    const theirs = await loadTaxSetAside(other, options());
    expect(theirs.estimateView.corrections).toEqual([]);
  });

  it("brings it up unasked as a fact for a real account, and drops it once covered", async () => {
    const { userId } = await person();
    const first = await detectFor(userId, options());
    const card = first.suggestions.find((s) => s.topic === "tax_not_yet_paid");
    expect(first.advice).toBe(false);
    expect(card?.confidence.percent).toBeGreaterThan(0);
    expect(card?.worthCents).toBe(await hold(userId));
    expect(first.suggestions.map((s) => s.topic)).not.toContain("tax_set_aside");

    await scanSuggestions(userId, options());
    expect(await client.suggestion.count({ where: { userId, topic: "tax_not_yet_paid" } })).toBe(1);
    // A correction moves the stored card too, so the dock says what the page says.
    await addTaxCorrection(
      userId,
      { kind: "paid", cents: 100_000, paidTo: "federal" },
      { ...options(), via: "page" },
    );
    const stored = await client.suggestion.findFirst({
      where: { userId, topic: "tax_not_yet_paid" },
    });
    expect(stored?.headline).toContain(formatWholeDollars(await hold(userId)));
    expect(stored?.headline).not.toMatch(/set aside/i);

    await addTaxCorrection(
      userId,
      { kind: "paid", cents: 5_000_000, paidTo: "federal" },
      { ...options(), via: "page" },
    );
    expect(await hold(userId)).toBe(0);
    const again = await detectFor(userId, options());
    expect(again.suggestions.map((s) => s.topic)).not.toContain("tax_not_yet_paid");
    // The scan after the correction puts the card away, so it leaves the dock.
    const gone = await client.suggestion.findFirst({
      where: { userId, topic: "tax_not_yet_paid" },
    });
    expect(["waiting", "selected"]).not.toContain(gone?.status);
  });

  it("a salary with no stubs is unknown, said so, never a confident number or $0", async () => {
    const { userId } = await person("salary");
    const aside = await loadTaxSetAside(userId, options());
    expect(aside.status).toBe("unknown");
    expect(aside.notYetPaidCents).toBeNull();
    expect(aside.holdCents).toBe(0);
    expect(aside.confidence.percent).toBeLessThanOrEqual(50);

    const s = await safe(userId);
    expect(s.taxHeldCents).toBe(0);
    const hero = heroView({
      asOf: "2026-11-04",
      safe: s,
      netWorth: null,
      foundCents: 0,
      savedCents: 0,
    }).safe!;
    expect(hero.why.find((l) => l.unknown)?.label).toContain("can't see what's withheld");
    const working = await explainFigure(userId, "safe_to_spend", options());
    expect(working?.rows.find((r) => r.label === "Not counted: tax")?.value).toBe("Not known");
    const topics = (await detectFor(userId, options())).suggestions.map((s) => s.topic);
    expect(topics).not.toContain("tax_not_yet_paid");

    // Their own figure settles it.
    await addTaxCorrection(
      userId,
      { kind: "withheld", cents: 100_000 },
      { ...options(), via: "page" },
    );
    const known = await loadTaxSetAside(userId, options());
    expect(known.withholdingKnown).toBe(true);
    expect(known.status).toBe("needed");
    expect((await safe(userId)).taxHeldCents).toBe(known.holdCents);
  });

  it("demo advice says set aside, in an advice topic, with the same figure", async () => {
    const { userId } = await person();
    vi.mocked(adviceMode).mockResolvedValue(true);
    try {
      const found = await detectFor(userId, options());
      const card = found.suggestions.find((s) => s.topic === "tax_set_aside");
      expect(card?.title).toMatch(/^Set aside about/);
      expect(card?.worthCents).toBe(await hold(userId));
      expect(found.suggestions.map((s) => s.topic)).not.toContain("tax_not_yet_paid");
      const aside = await loadTaxSetAside(userId, options());
      expect(aside.lines.find((l) => l.key === "left")?.label).toBe("Left to set aside");
    } finally {
      const real = await vi.importActual<typeof import("@/lib/advice-mode")>("@/lib/advice-mode");
      vi.mocked(adviceMode).mockImplementation(real.adviceMode);
    }
  });

  it("money in an account named for tax is seen, and comes off", async () => {
    const { userId } = await person();
    const before = await hold(userId);
    await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Tax savings",
        type: "depository",
        subtype: "savings",
        currentBalanceCents: 100_000,
      },
    });
    const aside = await loadTaxSetAside(userId, options());
    expect(aside.holdCents).toBe(before - 100_000);
    expect(aside.lines.find((l) => l.key === "kept_apart")?.from).toContain("Tax savings");
  });

  it("the same day either side of UTC midnight is the same figure", async () => {
    const { userId } = await person();
    await client.user.update({ where: { id: userId }, data: { timezone: "America/Los_Angeles" } });
    const afternoon = await loadTaxSetAside(userId, {
      client,
      now: new Date("2026-11-04T22:00:00Z"),
    });
    const evening = await loadTaxSetAside(userId, {
      client,
      now: new Date("2026-11-05T02:00:00Z"),
    });
    expect(evening.holdCents).toBe(afternoon.holdCents);
  });

  it("a finished year's bill paid in the spring counts", async () => {
    const { userId, checkingId } = await person();
    const spring = new Date("2027-03-10T18:00:00Z");
    const before = (await loadTaxSetAside(userId, { client, now: spring })).holdCents;
    expect(before).toBeGreaterThan(0);
    await client.transaction.create({
      data: row(
        userId,
        checkingId,
        "2027-03-05",
        before,
        "IRS USATAXPYMT",
        "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
      ),
    });
    expect((await loadTaxSetAside(userId, { client, now: spring })).holdCents).toBe(0);
  });
});
