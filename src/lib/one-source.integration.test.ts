import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { planFor } from "@/lib/plan";
import { loadBankFees } from "@/lib/bank-fees";
import { idleCash } from "@/detection/rules/idle-cash";
import { loadDetectionInput } from "@/detection/engine";
import { openShopSavingCents } from "@/lib/insurance/shop";
import { formatCents } from "@/lib/money";
import { loadCardInterest } from "@/lib/card-interest";
import { loadEquityTax } from "@/lib/equity-tax";
import { loadRetirementAccounts } from "@/lib/investments/retirement-accounts";
import { subscriptionYear } from "@/lib/jane-agent/recurring";
import { syncItem } from "@/lib/plaid/sync";
import { detectFor } from "@/lib/suggestions";
import { startTrial } from "@/lib/trial";

// One source of truth: a figure in the brief (a detector's suggestion) equals the figure the
// chat's tool gives for the same person. QA found the 401(k) match at $1,181 in the brief and
// $2,448 in the chat, and the RSU gap at $6,479 against "no RSU vests this year".
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("the brief and the chat give the same figure", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];
  const compared = { pages: 0, match: 0, rsu: 0, subs: 0, interest: 0, idle: 0, fees: 0, shop: 0 };

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  }, 120_000);
  afterAll(() => {
    // The comparison happened for someone (the test is not vacuous).
    expect(compared.pages).toBeGreaterThan(0);
    expect(compared.match).toBeGreaterThan(0);
    expect(compared.rsu).toBeGreaterThan(0);
    expect(compared.subs).toBeGreaterThan(0);
    expect(compared.interest).toBeGreaterThan(0);
    expect(compared.idle).toBeGreaterThan(0);
    expect(compared.fees).toBeGreaterThan(0);
    expect(compared.shop).toBeGreaterThan(0);
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it.each(PEOPLE.map((p) => p.id))(
    "%s: match, RSU, subscriptions and card interest",
    async (id) => {
      const trial = await startTrial({ client, now: NOW, defer: true, person: id });
      made.push(trial.userId);
      await syncItem(trial.itemId, { client, now: NOW });
      const { suggestions } = await detectFor(trial.userId, { client, now: NOW });
      const brief = (topic: string) => suggestions.find((s) => s.topic === topic);

      const match = (await loadRetirementAccounts(trial.userId, { client, now: NOW })).match;
      const matchBrief = brief("employer_match");
      if (matchBrief && match) compared.match++;
      if (matchBrief && match)
        expect(matchBrief.worthCents, "401(k) match").toBe(match.missedCents);
      // A person who gets the whole match is not told they miss it.
      if (match && match.missedCents <= 0) expect(matchBrief).toBeUndefined();

      // Subscriptions: a quarter of what the chat says they cost in a year.
      const subs = await subscriptionYear(trial.userId, { client, now: NOW });
      const subsBrief = brief("subscriptions");
      if (subsBrief) {
        compared.subs++;
        expect(subsBrief.short, "subscriptions a year").toContain(
          formatCents(Math.round(subs.yearlyCents)),
        );
      }
      // Card interest: the year of interest the loans page and the chat give.
      const interest = await loadCardInterest(trial.userId, { client, now: NOW });
      const interestBrief = brief("card_interest");
      if (interestBrief && interest.available) {
        compared.interest++;
        expect(interestBrief.worthCents, "card interest a year").toBe(interest.interestYearCents);
      }

      // The Plans page: each card's interest finding is worth that card's year of interest.
      const plan = await planFor(trial.userId, { client });
      const cards = new Map(
        interest.cards.map((c) => [`account:${c.accountId}`, c.interestYearCents]),
      );
      const findings = await client.finding.findMany({
        where: { userId: trial.userId, type: "card_interest" },
        select: { id: true, key: true, annualSavingsCents: true },
      });
      for (const f of findings) {
        if (!interest.available || !cards.has(f.key)) continue;
        compared.pages++;
        expect(f.annualSavingsCents, "card interest finding").toBe(cards.get(f.key));
        const item = plan.find((i) => i.card.findingId === f.id);
        if (item) expect(item.card.annualSavingsCents, "Plans page").toBe(cards.get(f.key));
      }

      // Idle cash: the Today card's finding and the brief are the same function.
      const idleBrief = brief("idle_cash");
      const idleFinding = idleCash(
        await loadDetectionInput(trial.userId, { client, now: NOW }),
        [],
      )[0];
      expect(!!idleBrief, "idle cash in both or neither").toBe(!!idleFinding);
      if (idleBrief && idleFinding) {
        compared.idle++;
        expect(idleBrief.worthCents).toBe(idleFinding.annualSavingsCents);
      }

      // Bank fees: a year of them, as the chat says.
      const fees = await loadBankFees(trial.userId, { client, now: NOW });
      const feesBrief = brief("bank_fees");
      if (feesBrief && fees) {
        compared.fees++;
        expect(feesBrief.worthCents, "bank fees a year").toBe(fees.yearCents);
      }

      // Insurance shopping: the real quote saving when there is one, else an estimate said so.
      const shopBrief = brief("insurance_shopping");
      if (shopBrief) {
        compared.shop++;
        const quoted = await openShopSavingCents(trial.userId, { client, now: NOW });
        if (quoted > 0) expect(shopBrief.worthCents, "quoted saving").toBe(quoted);
        else expect(shopBrief.why).toContain("an estimate, not a quote");
      }

      const equity = await loadEquityTax(trial.userId, { client, now: NOW });
      const rsuBrief = brief("withholding_gap");
      if (rsuBrief) {
        compared.rsu++;
        expect(equity.rsuGap, "the chat knows the stock plan").not.toBeNull();
        expect(rsuBrief.worthCents, "RSU withholding gap").toBe(equity.rsuGap!.shortfallCents);
        // Said as an assumption in both when no vests are on file.
        if (equity.rsuGap!.assumed) expect(rsuBrief.confidence.reason).toMatch(/assumed/);
      }
    },
  );

  // The employer plan's match is the original demo bank's person's (the sample people have no
  // employer plan): the brief and the retirement accounts page give the same figure for them.
  it("the original demo bank: the 401(k) match", async () => {
    const trial = await startTrial({ client, now: NOW, defer: true });
    made.push(trial.userId);
    await syncItem(trial.itemId, { client, now: NOW });
    const { suggestions } = await detectFor(trial.userId, { client, now: NOW });
    const matchBrief = suggestions.find((s) => s.topic === "employer_match");
    const match = (await loadRetirementAccounts(trial.userId, { client, now: NOW })).match;
    expect(match, "the demo employer plan").not.toBeNull();
    expect(matchBrief, "the match brief").toBeDefined();
    compared.match++;
    expect(matchBrief!.worthCents, "401(k) match").toBe(match!.missedCents);
  });
});
