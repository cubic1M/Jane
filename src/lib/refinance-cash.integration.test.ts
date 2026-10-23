import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseActions, parseRefs } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadFit } from "./fit";
import { ensureChecked, loadRefinance } from "./refinance";
import { withCashPayoffs } from "./refinance-cash";

// Loans QA against a real database, on the demo bank: the card that $24,000 of cash pays off
// for less than any loan isn't refinanced. "Should I refinance?", the offers page and Claude's
// tool say so, as the options card and "should I consolidate?" do; the car and student loans
// keep their picks.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("refinance against paying off with cash", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;
  const opts = { client: undefined as unknown as PrismaClient, now: NOW };

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    opts.client = client;
    const user = await client.user.create({
      data: { email: `refi-cash-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    const { itemId } = await linkDemoBank(userId, { client, now: NOW });
    await syncItem(itemId, { client, api: plaid, now: NOW });
    await ensureChecked(userId, opts);
  }, 120_000);
  afterAll(async () => {
    await client.user.delete({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("picks cash for the card, with the fit engine's saving, and keeps the loan picks", async () => {
    const before = await loadRefinance(userId, opts);
    const card = before.comparisons.find((c) => c.product === "personal")!;
    // Without the cash check the old pick is a personal loan for the card.
    expect(card.pick).not.toBeNull();
    const after = await withCashPayoffs(userId, before, opts);
    const cash = after.comparisons.find((c) => c.debtKey === card.debtKey)!;
    const fit = await loadFit(userId, { need: "refinance", debtKey: card.debtKey }, opts);
    expect(fit.pick).toBe("payoff");
    expect(cash.pick).toBeNull();
    expect(cash.cashPayoffCents).toBe(fit.options.find((o) => o.id === "payoff")!.savesCents);
    const loans = after.comparisons.filter((c) => c.product !== "personal" && c.pick);
    expect(loans.map((c) => c.product).sort()).toEqual(
      before.comparisons
        .filter((c) => c.product !== "personal" && c.pick)
        .map((c) => c.product)
        .sort(),
    );
  });

  it("says so in the chat and in Claude's tool, labelled, with no Apply button for the card", async () => {
    const { reply } = await sendToJane(userId, "should I refinance my credit card?", opts);
    expect(reply.body).toContain(
      "Your cash covers it: paying it off from savings would save about",
    );
    expect(reply.body).not.toContain("My pick:");
    expect(parseActions(reply.actions).map((a) => a.id)).not.toContain("loan.prepare");
    expect(parseRefs(reply.refs).advice).toBe(true);
    const tool = JSON.parse((await runChatTool(userId, "refinance_offers", {}, opts)).content);
    const card = tool.debts.find(
      (d: { payOffFromCashInstead?: unknown }) => d.payOffFromCashInstead,
    );
    expect(card.janesPick).toBeNull();
  });
});
