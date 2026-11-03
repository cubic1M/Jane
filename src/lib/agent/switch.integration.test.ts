import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/action-emails", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/action-emails")>()),
  sendStatusEmail: vi.fn(async () => {}),
}));

import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { comparisonFor } from "@/lib/compare";
import { DecisionError, recordDecision } from "@/lib/decisions";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { agentStep } from "./run";
import { confirmSwitches } from "./switch";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts),
// on the demo bank, from the comparison to the switch showing up on the account.
const url = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;
const LINKED = new Date("2026-10-18T15:00:00Z");
const later = (days: number) => new Date(LINKED.getTime() + days * DAY);

describe.runIf(url)("switching to the best option, on the demo bank", () => {
  let client: PrismaClient;
  let userId: string;
  let itemId: string;
  const plaid = {} as PlaidApi;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AUTH_SECRET", "test-only-secret-for-switch-tests-0123456789");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `switch-${crypto.randomUUID()}@example.com` } })
    ).id;
    ({ itemId } = await linkDemoBank(userId, { client, now: LINKED }));
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const findingWhere = async (type: string, test: (e: Record<string, unknown>) => boolean) => {
    const rows = await client.finding.findMany({
      where: { userId, type: type as never },
      select: CARD_SELECT,
    });
    const found = rows.find((f) => test((f.evidence ?? {}) as Record<string, unknown>));
    if (!found) throw new Error(`No ${type} finding`);
    return found;
  };

  // Decided (and started by the agent) at `when`.
  async function switchTo(
    finding: Awaited<ReturnType<typeof findingWhere>>,
    when: Date,
    optionId?: string,
  ) {
    const comparison = (await comparisonFor(finding, { userId, client }))!;
    const { actionId } = await recordDecision(
      userId,
      {
        findingId: finding.id,
        choice: "yes",
        cardHash: cardHash(buildCard(finding)),
        options: { switchTo: optionId ?? comparison.pick.option.id },
      },
      { client },
    );
    expect(await agentStep(userId, actionId!, { client, now: when })).toBe("waiting");
    return { actionId: actionId!, comparison };
  }

  const action = (id: string) => client.action.findUniqueOrThrow({ where: { id } });

  it("compares phone plans, switches with one yes, and cancels the old one only once the new bill shows", async () => {
    const phone = await findingWhere("bill_negotiation", (e) => e.billKind === "phone");
    const { actionId, comparison } = await switchTo(phone, LINKED);
    expect(comparison.pick.option.id).toBe("demo-opt-pine-mobile");
    expect(await action(actionId)).toMatchObject({
      status: "waiting_on_user",
      agentState: "switching",
      selfServiceUrl: "https://example.com/jane-demo/pine-mobile",
    });
    const decision = await client.decision.findFirstOrThrow({ where: { findingId: phone.id } });
    expect(decision.options).toMatchObject({
      switchTo: "demo-opt-pine-mobile",
      switchKind: "plan",
      switchFromMonthlyCents: 14_500,
      switchWasPick: 1,
    });

    // The next day: no new bill yet, still switching.
    await syncItem(itemId, { client, api: plaid, now: later(1) });
    expect((await action(actionId)).agentState).toBe("switching");

    // Two days after the switch, the first Pine Mobile bill: the team cancels Verizon.
    await syncItem(itemId, { client, api: plaid, now: later(3) });
    const done = await action(actionId);
    expect(done).toMatchObject({
      agentState: "handed_off",
      confirmedAnnualCents: (14_500 - 3_500) * 12,
    });
    expect(done.handoffReason).toContain("Cancel Verizon Wireless now");
  });

  it("confirms a cheaper tier from its first cheaper charge", async () => {
    const netflix = await findingWhere("price_increase", (e) => e.merchant === "Netflix");
    const { actionId } = await switchTo(netflix, later(3));
    await syncItem(itemId, { client, api: plaid, now: later(6) });
    expect(await action(actionId)).toMatchObject({
      status: "done",
      agentState: "finished",
      confirmedAnnualCents: (1_799 - 799) * 12,
    });
  });

  it("confirms a savings switch when the money is seen leaving, and counts what it earns", async () => {
    const cash = await findingWhere("idle_cash", () => true);
    const { actionId, comparison } = await switchTo(cash, later(6));
    expect(comparison.pick.option.id).toBe("demo-opt-cobalt-savings");
    await syncItem(itemId, { client, api: plaid, now: later(9) });
    const amount = comparison.current.kind === "savings" ? comparison.current.amountCents : 0;
    expect(await action(actionId)).toMatchObject({
      status: "done",
      confirmedAnnualCents: Math.round((amount * (435 - 50)) / 10_000),
    });
  });

  it("passes a switch to the team when nothing shows up in time", async () => {
    const internet = await findingWhere(
      "bill_negotiation",
      (e) => e.billKind === "internet and TV",
    );
    const { actionId } = await switchTo(internet, later(9), "demo-opt-lantern-fiber");
    // No sync in between, so no new bill.
    await confirmSwitches({ client, now: later(9 + 46), userId });
    expect((await action(actionId)).handoffReason).toContain("No sign of the switch");
  });

  it("refuses an option that wasn't compared", async () => {
    const spotify = await findingWhere("subscription_review", (e) => e.merchant === "Spotify");
    await expect(
      recordDecision(
        userId,
        {
          findingId: spotify.id,
          choice: "yes",
          cardHash: cardHash(buildCard(spotify)),
          options: { switchTo: "demo-opt-pine-mobile" },
        },
        { client },
      ),
    ).rejects.toBeInstanceOf(DecisionError);
  });

  it("never shows demo examples to someone without the demo bank", async () => {
    const other = await client.user.create({
      data: { email: `real-${crypto.randomUUID()}@example.com` },
    });
    const phone = await findingWhere("bill_negotiation", (e) => e.billKind === "phone");
    expect(await comparisonFor(phone, { userId: other.id, client })).toBeNull();
    await client.user.delete({ where: { id: other.id } });
  });
});
