import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { refinanceSource } from "@/lib/jane-agent/sources/refinance";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseActions, parseRefs } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import type { PersonId } from "@/config/people";
import { loadFit } from "./fit";
import { checkRates, ensureChecked, loadRefinance, refreshRefinance } from "./refinance";

// Loans QA against a real database: refinance picks agree with the fit engine (the options card
// and "should I consolidate?"). The demo person's spare cash clears their card for less than
// any loan, so the card isn't refinanced; Chris (score 560) would be turned down for a loan on
// his cards, so none is picked or offered unasked; picks the fit engine agrees with stay.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const context = { now: NOW, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("refinance picks the fit engine agrees with", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  let demo: string;
  let chris: string;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;
  const opts = () => ({ client, now: NOW });
  const make = async (person?: PersonId) => {
    const user = await client.user.create({
      data: { email: `refi-fit-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person });
    await syncItem(itemId, { client, api: plaid, now: NOW });
    await ensureChecked(user.id, opts());
    return user.id;
  };

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    demo = await make();
    chris = await make("debt");
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("picks cash for the demo person's card, with the fit engine's saving, and keeps the loan picks", async () => {
    const refi = await loadRefinance(demo, opts());
    const card = refi.comparisons.find((c) => c.product === "personal")!;
    const fit = await loadFit(demo, { need: "refinance", debtKey: card.debtKey }, opts());
    expect(fit.pick).toBe("payoff");
    expect(card.pick).toBeNull();
    expect(card.cashPayoffCents).toBe(fit.options.find((o) => o.id === "payoff")!.savesCents);
    // The car loan's pick stays (a car or student loan is never paid off from cash here).
    expect(refi.comparisons.find((c) => c.product === "auto")!.pick).not.toBeNull();
  });

  it("says so in the chat and Claude's tool, labelled, with no Apply button for the card", async () => {
    const { reply } = await sendToJane(demo, "should I refinance my credit card?", opts());
    expect(reply.body).toContain(
      "Your cash covers it: paying it off from savings would save about",
    );
    expect(reply.body).not.toContain("My pick:");
    expect(parseActions(reply.actions).map((a) => a.id)).not.toContain("loan.prepare");
    expect(parseRefs(reply.refs).advice).toBe(true);
    const tool = JSON.parse((await runChatTool(demo, "refinance_offers", {}, opts())).content);
    const card = tool.debts.find(
      (d: { payOffFromCashInstead?: unknown }) => d.payOffFromCashInstead,
    );
    expect(card.janesPick).toBeNull();
  });

  it("picks no loan for Chris's cards a lender would turn down, and offers none unasked", async () => {
    const refi = await loadRefinance(chris, opts());
    const cards = refi.comparisons.filter((c) => c.product === "personal");
    expect(cards.length).toBe(3);
    for (const c of cards) {
      expect(c.pick).toBeNull();
      expect(c.turnedDown).toMatch(
        /^Lenders usually want a score of 600 or more for this; yours is \d+\.$/,
      );
    }
    const { reply } = await sendToJane(chris, "should I refinance my credit card?", opts());
    expect(reply.body).toContain(
      "a lender would likely turn this down: Lenders usually want a score of 600",
    );
    const snapshot = (await loadSnapshot(chris, opts()))!;
    const offered = refinanceSource.gather(snapshot, context);
    for (const m of offered) {
      expect(m.body).not.toMatch(/Credit Card|Store Card/);
    }
    const tool = JSON.parse((await runChatTool(chris, "refinance_offers", {}, opts())).content);
    expect(
      tool.debts.filter((d: { lenderWouldLikelyDecline?: string }) => d.lenderWouldLikelyDecline),
    ).toHaveLength(3);
  });

  it("checks again offers kept before the verdicts were stored", async () => {
    const row = await client.refinanceCheck.findUniqueOrThrow({ where: { userId: chris } });
    const old = (row.quotes as { verdict?: unknown }[]).map(({ verdict: _, ...q }) => q);
    await client.refinanceCheck.update({ where: { userId: chris }, data: { quotes: old } });
    // Old offers show the stand-in's raw pick until checked again; opening the page does it.
    expect(await ensureChecked(chris, opts())).toBe(true);
    expect((await loadRefinance(chris, opts())).comparisons.some((c) => c.turnedDown)).toBe(true);
    expect(await refreshRefinance(chris, opts())).toBe(false);
    await checkRates(chris, opts());
  });
});
