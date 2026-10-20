import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { takeChatAction } from "@/lib/jane-agent/actions";
import { postMessages } from "@/lib/jane-agent/messages";
import { rankedFor } from "@/lib/jane-agent/priorities";
import { whatIfReply } from "@/lib/jane-agent/replies-whatif";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { loadPayoff } from "@/lib/debt-plan";
import { healthInput } from "@/lib/health-score";
import { loadDetectionInput } from "@/detection/engine";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { adoptedPlans, loadBaseline, whatIf } from "./what-if";

// Spec step 203 against a real, migrated Postgres, with the demo bank: a scenario's figures
// are the other sectors' own (cash from the health score's averages, the debt-free month
// from the debt plan), running it changes nothing, and adopting it puts its changes among
// the next best things.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-16T15:00:00Z");

describe.runIf(url)("what if", { timeout: 120_000 }, () => {
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
      data: { email: `whatif-${crypto.randomUUID()}@example.com` },
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

  it("uses the other sectors' own figures", async () => {
    const baseline = (await loadBaseline(userId, { client, now: NOW }))!;
    const input = await loadDetectionInput(userId, { client, now: NOW });
    const health = await healthInput(userId, input, { client, now: NOW });
    expect(baseline.cashCents).toBe(health.cashCents);
    expect(baseline.monthlyIncomeCents).toBe(health.monthlyIncomeCents);
    expect(baseline.monthlySpendingCents).toBe(health.monthlySpendingCents);
    const payoff = await loadPayoff(userId, { client, now: NOW });
    expect(baseline.debt).toMatchObject({ hasDebts: true, before: payoff.debtFreeMonth });

    const run = (await whatIf(userId, "job_loss", { months: 12 }, { client, now: NOW }))!;
    // Losing a year's pay: the debt plan's own answer with no extra payment.
    const without = await loadPayoff(userId, { client, now: NOW, extraCents: 0 });
    expect(run.sectors.debt).toContain(
      new Date(`${without.debtFreeMonth}-01T00:00:00Z`).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
    );
    expect(run.after.rows).toHaveLength(12);
    expect(run.before.rows[0].balanceCents - run.after.rows[0].balanceCents).toBe(
      baseline.monthlyIncomeCents,
    );
  });

  it("changes nothing until adopted, then the plan is among the next best things", async () => {
    expect(await adoptedPlans(userId, { client })).toEqual([]);
    const run = (await whatIf(userId, "baby", {}, { client, now: NOW }))!;
    const reply = whatIfReply(run);
    expect(reply.body).toMatch(/^A new baby: /);
    expect(reply.body).toMatch(/nothing has changed\.$/);
    await postMessages(
      userId,
      [
        {
          kind: "decision",
          body: reply.body,
          refs: reply.refs,
          actions: reply.actions,
          dedupeKey: "whatif:baby",
          priority: 1,
          source: "whatif",
        },
      ],
      { client, now: NOW },
    );
    const message = await client.janeMessage.findFirstOrThrow({
      where: { userId, dedupeKey: "whatif:baby" },
    });
    const { message: answered } = await takeChatAction(userId, message.id, "whatif.adopt", {
      client,
      now: NOW,
    });
    expect(answered.refs.note).toMatch(/^Done\. \d+ steps are on your list/);
    const plans = await adoptedPlans(userId, { client });
    expect(plans).toHaveLength(1);
    expect(plans[0].changes.length).toBe(run.plan.length);

    const snapshot = (await loadSnapshot(userId, { client, now: NOW }))!;
    const titles = rankedFor(snapshot).map((r) => r.title);
    expect(titles).toEqual(expect.arrayContaining([run.plan[0].title]));
    // Nothing was done by adopting: no transfers, goals or budgets were made.
    expect(await client.moneyTransfer.count({ where: { userId } })).toBe(0);
  });

  it("has nothing to run before accounts are linked", async () => {
    const empty = await client.user.create({
      data: { email: `whatif-none-${crypto.randomUUID()}@example.com` },
    });
    created.push(empty.id);
    expect(await whatIf(empty.id, "raise", {}, { client, now: NOW })).toBeNull();
    expect(whatIfReply(null).body).toMatch(/^Once your accounts are linked/);
  });
});
