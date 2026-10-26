import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { creditBuildingSource } from "@/lib/jane-agent/sources/credit-building";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseActions, parseRefs } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { setSectorAutopilot } from "@/lib/sector-autopilot";
import { setAutopilot } from "@/lib/autopilot";
import {
  CreditBuildingError,
  applyForBuilder,
  loadCreditBuilding,
  payBeforeStatement,
  runCreditBuilding,
} from "./credit-building";
import { pullCredit } from "./credit";

// Spec step 175 against a real, migrated Postgres, on the demo bank: paying before a card's
// statement closes (one tap, or by Jane at Handle the safe stuff within the debt caps),
// the on-time streak, the labelled score simulator, a credit-builder stand-in for a thin
// file, and nothing for a real account.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
// Six days before the statement closes on November 1.
const NEAR = new Date("2026-10-27T15:00:00Z");
const MINUTE = 60 * 1000;
const context = { now: NEAR, local: { date: "2026-10-27", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("building credit against a real database", { timeout: 30_000 }, () => {
  let client: PrismaClient;
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
  const later = () => new Date(NEAR.getTime() + ++tick * MINUTE);
  const opts = (now = NEAR) => ({ client, now });
  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }
  async function demoPerson(prefix: string) {
    const id = await person(prefix);
    const { itemId } = await linkDemoBank(id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    await pullCredit(id, opts());
    return id;
  }

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("plans the payment before the statement closes, to the limits' 30% or 10%", async () => {
    const id = await demoPerson("build-plan");
    const data = await loadCreditBuilding(id, opts());
    expect(data.available).toBe(true);
    const s = data.statement!;
    expect(s.cardName).toMatch(/^Demo Credit Card/);
    expect(s.closesOn).toBe("2026-11-01");
    expect(s.payOn).toBe("2026-10-30");
    expect(s.due).toBe(true);
    // $2,410.50 on an $8,000 limit: $10.50 over 30%, $1,610.50 over 10%.
    expect(s.toUnderHighCents).toBe(1_050);
    expect(s.toUnderGoodCents).toBe(161_050);
    expect(s.suggested).not.toBeNull();
    expect(s.scheduled).toBeNull();
    expect(s.canPay).toBe(true);
  });

  it("asks with one tap, schedules the payment through the money-movement stand-in, audited", async () => {
    const id = await demoPerson("build-tap");
    const snapshot = (await loadSnapshot(id, opts()))!;
    const [message] = creditBuildingSource
      .gather(snapshot, context)
      .filter((c) => c.dedupeKey.startsWith("statement:"));
    expect(message.body).toMatch(
      /^Pay \$[\d,.]+ on your Demo Credit Card.* by Oct 30, before its statement closes on Nov 1\./,
    );
    expect(message.refs).toMatchObject({
      advice: true,
      creditStatement: { closesOn: "2026-11-01" },
    });
    expect(message.actions[0]).toMatchObject({ id: "credit_build.pay" });
    const { reply } = await sendToJane(id, "when does my statement close?", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(/before its statement closes on Nov 1/);
    expect(parseActions(reply.actions)[0].id).toBe("credit_build.pay");
    const tapped = await takeChatAction(id, reply.id, "credit_build.pay", { client, now: later() });
    expect(tapped.message.refs.note).toMatch(
      /^Scheduled: \$[\d,.]+ to your Demo Credit Card.* on Oct 30, before the statement closes on Nov 1\./,
    );
    const transfer = await client.moneyTransfer.findFirstOrThrow({ where: { userId: id } });
    expect(transfer).toMatchObject({
      purpose: "debt",
      sector: "debt",
      by: "person",
      status: "pending",
    });
    expect(transfer.planKey).toMatch(/^statement:.*:2026-11-01$/);
    // Once, and the page says so.
    await expect(
      payBeforeStatement(id, { accountId: transfer.toAccountId!, closesOn: "2026-11-01" }, opts()),
    ).rejects.toThrow(CreditBuildingError);
    expect((await loadCreditBuilding(id, opts())).statement!.scheduled).toMatchObject({
      by: "person",
    });
  });

  it("never pays on its own at Ask me first; at Handle the safe stuff it does, within the caps", async () => {
    const id = await demoPerson("build-auto");
    expect(await runCreditBuilding(id, opts())).toBe(false);
    expect(await client.moneyTransfer.count({ where: { userId: id } })).toBe(0);
    await setAutopilot(id, "safe", { client });
    await setSectorAutopilot(
      id,
      "debt",
      { level: "safe", actionCapCents: 200_000, monthlyCapCents: 300_000 },
      { client, now: NEAR },
    );
    expect(await runCreditBuilding(id, opts())).toBe(true);
    const transfer = await client.moneyTransfer.findFirstOrThrow({ where: { userId: id } });
    expect(transfer).toMatchObject({ by: "autopilot", sector: "debt" });
    expect(await client.autopilotAct.count({ where: { userId: id, sector: "debt" } })).toBe(1);
    // Not twice for the same statement.
    expect(await runCreditBuilding(id, opts())).toBe(false);
    const snapshot = (await loadSnapshot(id, opts()))!;
    const paid = creditBuildingSource
      .gather(snapshot, context)
      .find((c) => c.dedupeKey.startsWith("statement_paid:"))!;
    expect(paid.kind).toBe("done");
    expect(paid.body).toMatch(
      /goes to your Demo Credit Card.* on Oct 30, before its statement closes on Nov 1/,
    );
  });

  it("holds Jane to the debt caps: a payment over the per-action cap waits for a tap", async () => {
    const id = await demoPerson("build-cap");
    await setAutopilot(id, "safe", { client });
    await setSectorAutopilot(
      id,
      "debt",
      { level: "safe", actionCapCents: 100, monthlyCapCents: 100 },
      { client, now: NEAR },
    );
    expect(await runCreditBuilding(id, opts())).toBe(false);
    expect(await client.moneyTransfer.count({ where: { userId: id } })).toBe(0);
  });

  it("estimates the score after each change, labelled, and changes nothing", async () => {
    const id = await demoPerson("build-sim");
    const data = await loadCreditBuilding(id, opts());
    const pay = data.estimates.find((e) => e.key === "pay_to_10")!;
    expect(pay.score).toBeGreaterThan(data.score!);
    // A new card adds limit and a hard inquiry: worth less than paying the cards down.
    expect(data.estimates.find((e) => e.key === "new_card")!.change).toBeLessThan(pay.change);
    const { reply } = await sendToJane(id, "what would my score be if I paid off my card", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(/^Pay your cards .* would take your score from \d+ to about \d+/);
    expect(reply.body).toMatch(
      /estimates from the stand-in score's simulator, and nothing changes until you act/,
    );
    const before = await client.creditReport.count({ where: { userId: id } });
    await sendToJane(id, "credit score simulator", { client, now: later() });
    expect(await client.creditReport.count({ where: { userId: id } })).toBe(before);
    const tool = JSON.parse((await runChatTool(id, "credit_building", {}, opts())).content);
    expect(tool.note).toMatch(/estimates/);
    expect(tool.simulatorEstimates.length).toBeGreaterThan(0);
  });

  it("answers how to build credit with the payment, the streak and the biggest step", async () => {
    const id = await demoPerson("build-ask");
    const { reply } = await sendToJane(id, "how do I build my credit?", { client, now: later() });
    expect(reply.body).toMatch(/before its statement closes/);
    expect(reply.body).toMatch(/The biggest step from your score of \d+/);
    expect(parseRefs(reply.refs).advice).toBe(true);
  });

  it("counts the on-time streak and says well done at a milestone", async () => {
    const id = await demoPerson("build-streak");
    const data = await loadCreditBuilding(id, opts());
    // The demo bank has one late fee in the year; the streak counts from it.
    expect(data.streak!.clean).toBe(false);
    const snapshot = (await loadSnapshot(id, opts()))!;
    const found = creditBuildingSource
      .gather(snapshot, context)
      .filter((c) => c.dedupeKey.startsWith("streak:"));
    expect(found.length).toBe(data.streak!.milestone ? 1 : 0);
  });

  it("offers a credit-builder stand-in to a thin file, only on a tap, audited", async () => {
    const id = await demoPerson("build-thin");
    // A thin file: the stand-in bureau says accounts average a few years, so make it one.
    await client.creditReport.updateMany({ where: { userId: id }, data: { averageAgeMonths: 10 } });
    const data = await loadCreditBuilding(id, opts());
    expect(data.thin).toBe(true);
    expect(data.builders.map((b) => b.id)).toContain("willow-secured");
    const result = await applyForBuilder(id, "willow-secured", opts());
    expect(result.product.name).toBe("Willow Secured Card");
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      { type: "user", id },
      "card_application_submitted",
      expect.objectContaining({ type: "card_application" }),
      expect.objectContaining({ builder: true }),
    );
    await expect(applyForBuilder(id, "willow-secured", opts())).rejects.toThrow(
      CreditBuildingError,
    );
    await expect(applyForBuilder(id, "not-a-product", opts())).rejects.toThrow(CreditBuildingError);
  });

  it("never plans, estimates or offers anything for a real account", async () => {
    const realId = await person("build-real");
    const data = await loadCreditBuilding(realId, opts());
    expect(data.available).toBe(false);
    expect(await runCreditBuilding(realId, opts())).toBe(false);
    await expect(applyForBuilder(realId, "willow-secured", opts())).rejects.toThrow(
      CreditBuildingError,
    );
    expect(await client.moneyTransfer.count({ where: { userId: realId } })).toBe(0);
  });
});
