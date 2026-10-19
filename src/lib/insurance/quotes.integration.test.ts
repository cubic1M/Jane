import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { sendToJane } from "@/lib/jane-agent/typing";
import { EMPTY_POLICY_INPUT, addPolicy } from "./policies";
import { ensureDemoPolicies } from "./profile";
import { quoteById, quotesFor, requestQuotes } from "./quotes";

// Quotes against a real, migrated Postgres (spec step 103): the stand-in answers only for
// demo-bank people, quotes are kept like for like and replaced by the next request, and the
// chat asks for them by rules and by button.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-19T16:00:00Z");
const DAY = 86_400_000;

describe.runIf(url)("insurance quotes against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person(demo: boolean) {
    const user = await client.user.create({
      data: { email: `ins-q-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    if (demo) {
      await client.plaidItem.create({
        data: {
          userId: user.id,
          plaidItemId: `demo-${crypto.randomUUID()}`,
          accessTokenEncrypted: "v1:unused",
        },
      });
    }
    return user.id;
  }
  const demoPolicyOf = async (userId: string) => {
    await ensureDemoPolicies(userId, { client, now: NOW });
    return (await client.insurancePolicy.findFirstOrThrow({ where: { userId } })).id;
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("gets demo quotes for a demo-bank person, like for like, and keeps only the newest", async () => {
    const me = await person(true);
    const policyId = await demoPolicyOf(me);
    const result = await requestQuotes(me, policyId, { client, now: NOW });
    expect(result.kind).toBe("quotes");
    if (result.kind !== "quotes") return;
    expect(result.currentAnnualCents).toBe(170_400);
    expect(result.quotes.map((q) => [q.carrier.name, q.annualPremiumCents, q.sameCover])).toEqual([
      ["Northstar Assurance (demo)", 110_400, false],
      ["Cedar & Stone (demo)", 115_200, false],
      ["Lighthouse Insurance (demo)", 129_600, true],
      ["Bluepeak Mutual (demo)", 142_800, true],
    ]);
    expect(result.quotes[0].differences).toEqual([
      "Property damage liability: $25,000.00 instead of your $50,000.00",
    ]);
    expect(result.quotes.every((q) => q.demo && q.partner === "demo")).toBe(true);

    const again = await requestQuotes(me, policyId, { client, now: new Date(NOW.getTime() + DAY) });
    expect(await client.insuranceQuote.count({ where: { userId: me } })).toBe(4);
    if (again.kind !== "quotes") throw new Error("expected quotes");
    // Expired quotes aren't offered.
    expect(
      await quotesFor(me, policyId, { client, now: new Date(NOW.getTime() + 40 * DAY) }),
    ).toEqual([]);
    // Only the person's own.
    const other = await person(true);
    expect(await quoteById(other, again.quotes[0].id, { client, now: NOW })).toBeNull();
    expect(await requestQuotes(other, policyId, { client, now: NOW })).toEqual({
      kind: "unavailable",
      reason: "not_found",
    });
  });

  it("gets no quotes for real accounts, or for kinds the partner doesn't write", async () => {
    const real = await person(false);
    const auto = await addPolicy(
      real,
      { ...EMPTY_POLICY_INPUT, kind: "auto", carrier: "GEICO" },
      { client },
    );
    expect(await requestQuotes(real, auto, { client, now: NOW })).toEqual({
      kind: "unavailable",
      reason: "no_partner",
    });
    const demo = await person(true);
    const health = await addPolicy(
      demo,
      { ...EMPTY_POLICY_INPUT, kind: "health", carrier: "Aetna" },
      { client },
    );
    expect(await requestQuotes(demo, health, { client, now: NOW })).toEqual({
      kind: "unavailable",
      reason: "not_quotable",
    });
  });

  it("gets quotes from the chat by rules and by the Compare quotes button", async () => {
    const me = await person(true);
    await demoPolicyOf(me);
    // A CSV account next to the demo bank: quotes, but no demo advice (no pick, spec 104).
    await client.account.create({
      data: { userId: me, source: "csv", name: "Card", type: "credit", subtype: "credit card" },
    });
    const { reply } = await sendToJane(me, "find me cheaper car insurance", { client, now: NOW });
    expect(reply.body.split("\n")).toEqual([
      "The lowest price for the same cover as your GEICO car insurance is Lighthouse Insurance (demo), at $1,296.00 a year, $408.00 less than you pay now.",
      "- Northstar Assurance (demo), rated A-: $92.00 a month ($1,104.00 a year, $600.00 less), not the same cover: Property damage liability: $25,000.00 instead of your $50,000.00",
      "- Cedar & Stone (demo), rated A: $96.00 a month ($1,152.00 a year, $552.00 less), not the same cover: Uninsured driver cover: not included, and you have it now",
      "- Lighthouse Insurance (demo), rated A+: $108.00 a month ($1,296.00 a year, $408.00 less), same cover",
      "And 1 more on the quotes page.",
      "These are sample quotes from my demo carrier catalog, not real offers.",
      "Nothing changes unless you say so.",
    ]);

    const { reply: cost } = await sendToJane(me, "how much is my car insurance", {
      client,
      now: NOW,
    });
    expect(cost.actions.map((a) => a.id)).toEqual(["insurance.quotes", "open"]);
    const { message } = await takeChatAction(me, cost.id, "insurance.quotes", { client, now: NOW });
    expect(message.answeredWith).toBe("Compare quotes");
    expect(message.refs.note).toMatch(/^The lowest price for the same cover/);
    expect(message.actions).toEqual([
      expect.objectContaining({ id: "open", label: "See the quotes" }),
    ]);

    const tool = JSON.parse(
      (await runChatTool(me, "insurance_quotes", {}, { client, now: NOW })).content,
    );
    expect(tool.partnerAvailable).toBe(true);
    expect(tool.policies[0].quotes[2]).toMatchObject({
      carrier: "Lighthouse Insurance (demo)",
      aYear: "$1,296.00",
      savingAYear: "$408.00",
      sameCoverAndDeductible: true,
      sample: true,
    });
  });

  it("says quotes aren't available to a real account in the chat", async () => {
    const real = await person(false);
    await addPolicy(real, { ...EMPTY_POLICY_INPUT, kind: "auto", carrier: "GEICO" }, { client });
    const { reply } = await sendToJane(real, "compare car insurance", { client, now: NOW });
    expect(reply.body).toMatch(/^I can't get insurance quotes for you yet/);
    const { reply: cost } = await sendToJane(real, "how much is my car insurance", {
      client,
      now: NOW,
    });
    expect(cost.actions.map((a) => a.id)).not.toContain("insurance.quotes");
  });
});
