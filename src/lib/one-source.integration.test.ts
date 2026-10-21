import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

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
  const compared = { match: 0, rsu: 0, subs: 0, interest: 0 };

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  }, 120_000);
  afterAll(() => {
    // The comparison happened for someone (the test is not vacuous).
    expect(compared.match).toBeGreaterThan(0);
    expect(compared.rsu).toBeGreaterThan(0);
    expect(compared.subs).toBeGreaterThan(0);
    expect(compared.interest).toBeGreaterThan(0);
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
});
