import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { setAutopilot } from "@/lib/autopilot";
import { DisasterError, loadDisasterRelief, recordDisasterLoss } from "@/lib/disasters";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { setSectorAutopilot } from "@/lib/sector-autopilot";
import { runTaxAutopilot } from "@/lib/tax-autopilot";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { parseTaxIntent } from "./tax-intents";
import { parseActions } from "./types";
import { sendToJane } from "./typing";

// Spec step 270 against a real, migrated Postgres: a disaster postponement for the person's
// county (from the stand-in feed, demo bank only) moves every affected tax deadline, on a tap or
// by itself at the levels that let Jane act, once; the loss after FEMA and insurance is kept
// with the insurance claim, and never recorded twice.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const day = (d: string) => new Date(`${d}T00:00:00Z`);

describe("the disaster questions people ask", () => {
  it.each([
    "do I get more time on my taxes after the storm",
    "can I deduct the flood damage",
    "is there irs disaster relief for my county",
    "casualty loss",
  ])("reads %j as the disaster question", (text) => {
    expect(parseTaxIntent(text)).toEqual({ kind: "tax", ask: "disaster" });
  });

  it("reads where they live", () => {
    expect(parseTaxIntent("i live in fort bend county")).toEqual({
      kind: "tax",
      ask: "set_county",
      county: "fort bend",
    });
  });
});

describe.runIf(url)("disasters and losses against a real database", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no plaid");
      },
    },
  ) as PlaidApi;

  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    const checking = await client.account.findFirstOrThrow({
      where: { userId: user.id, subtype: "checking" },
    });
    const row = (date: string, amountCents: number, description: string, pfc: string) =>
      client.transaction.create({
        data: {
          userId: user.id,
          accountId: checking.id,
          source: "plaid",
          date: day(date),
          amountCents,
          description,
          pfcDetailed: pfc,
        },
      });
    await row(
      "2026-04-10",
      290_000,
      "HARRIS COUNTY TAX ASSESSOR",
      "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
    );
    await row(
      "2026-09-20",
      3_600_000,
      "BAYOU FLOORING AND DRYWALL",
      "HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE",
    );
    await row("2026-10-06", -500_000, "FEMA IHP TREAS 310 DISASTER ASSIST", "TRANSFER_IN_DEPOSIT");
    const deadline = (title: string, dueOn: string, done = false) =>
      client.deadline.create({
        data: {
          userId: user.id,
          title,
          dueOn: day(dueOn),
          kind: "other",
          doneAt: done ? LINKED : null,
        },
      });
    await deadline("Pay estimated tax for Q4", "2027-01-15");
    await deadline("Make your 2026 IRA contribution", "2027-04-15");
    await deadline("Get your IRS Identity Protection PIN", "2027-01-31");
    await deadline("Pay estimated tax for Q3", "2026-09-15", true);
    await deadline("Use the $200 travel credit", "2026-12-31");
    await deadline("Pay estimated tax for Q2", "2026-06-15");
    return user.id;
  }
  const dueOf = async (userId: string) =>
    Object.fromEntries(
      (await client.deadline.findMany({ where: { userId } })).map((d) => [
        d.title,
        d.dueOn.toISOString().slice(0, 10),
      ]),
    );
  const gather = async (userId: string) =>
    taxesSource.gather((await loadSnapshot(userId, { client, now: LINKED }))!, {
      now: LINKED,
      local: { date: "2026-10-18", hour: 8 },
      trigger: "open",
    });

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("moves every affected tax deadline on a tap, once, and nothing else", async () => {
    const userId = await person("dis");
    const v = await loadDisasterRelief(userId, { client, now: LINKED });
    expect(v).toMatchObject({ county: "Harris", countySource: "seen" });
    expect(v.relief.map((r) => r.relief.id)).toEqual(["SAMPLE-TX-2026-09"]);
    expect(v.relief[0].moves.map((m) => m.title).sort()).toEqual([
      "Get your IRS Identity Protection PIN",
      "Make your 2026 IRA contribution",
      "Pay estimated tax for Q4",
    ]);

    const c = (await gather(userId)).find((x) => x.dedupeKey === "disaster:SAMPLE-TX-2026-09")!;
    expect(c.kind).toBe("decision");
    expect(c.body).toContain("postponed federal tax deadlines for Harris County");
    expect(c.body).toContain("3 tax deadlines on your list fall in that window");
    expect(c.body).toContain("sample declaration");
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: c.kind,
        body: c.body,
        refs: c.refs,
        actions: c.actions,
        dedupeKey: `taxes:${c.dedupeKey}`,
      },
    });
    expect(parseActions(message.actions).map((a) => a.id)).toEqual([
      "tax.disaster_move",
      "tax.disaster_loss",
      "open",
    ]);
    const after = await takeChatAction(userId, message.id, "tax.disaster_move", {
      client,
      now: LINKED,
    });
    expect(after.message.refs.note).toBe("Done: 3 tax deadlines moved to 2027-05-03.");
    expect(await dueOf(userId)).toEqual({
      "Pay estimated tax for Q4": "2027-05-03",
      "Make your 2026 IRA contribution": "2027-05-03",
      "Get your IRS Identity Protection PIN": "2027-05-03",
      "Pay estimated tax for Q3": "2026-09-15",
      "Use the $200 travel credit": "2026-12-31",
      "Pay estimated tax for Q2": "2026-06-15",
    });
    const moved = await client.deadline.findFirstOrThrow({
      where: { userId, title: "Pay estimated tax for Q4" },
    });
    expect(moved.note).toContain("Moved from 2027-01-15 by the IRS disaster postponement");

    // Once: the message turns into what Jane did, and a second tap is refused.
    const done = (await gather(userId)).find((x) => x.dedupeKey.startsWith("disaster:"))!;
    expect(done.dedupeKey).toBe("disaster:SAMPLE-TX-2026-09:moved");
    expect(done.kind).toBe("done");
    await expect(
      takeChatAction(userId, message.id, "tax.disaster_move", { client, now: LINKED }),
    ).rejects.toThrow();
  });

  it("moves them by itself at the levels that let Jane act", async () => {
    const userId = await person("dis-auto");
    await setAutopilot(userId, "all", { client, now: LINKED });
    await setSectorAutopilot(userId, "taxes", { level: "all" }, { client, now: LINKED });
    const r = await runTaxAutopilot(userId, { client, now: LINKED });
    // Hers, and the tax plan's deadlines the same run put on the list: every one in the window.
    expect(r.disasterMoved).toBeGreaterThanOrEqual(3);
    expect((await dueOf(userId))["Pay estimated tax for Q4"]).toBe("2027-05-03");
    const v = await loadDisasterRelief(userId, { client, now: LINKED });
    expect(v.relief[0]).toMatchObject({ applied: true, moves: [] });
    expect((await runTaxAutopilot(userId, { client, now: LINKED })).disasterMoved).toBe(0);
  });

  it("keeps the loss with the insurance claim, counted once", async () => {
    const userId = await person("dis-loss");
    const claim = await client.insuranceClaim.create({
      data: {
        userId,
        kind: "home",
        event: "storm",
        happenedOn: day("2026-09-09"),
        carrier: "State Farm",
        payoutCents: 800_000,
      },
    });
    const v = await loadDisasterRelief(userId, { client, now: LINKED });
    const r = v.relief[0];
    // FEMA's $5,000 and the insurer's $8,000: the larger is what came back for these repairs.
    expect(r.claim).toMatchObject({ id: claim.id, carrier: "State Farm" });
    expect(r.loss).toMatchObject({ repairsCents: 3_600_000, reimbursedCents: 800_000 });
    expect(r.loss.lossCents).toBe(2_800_000);

    const row = await recordDisasterLoss(userId, r.relief.id, { client, now: LINKED });
    expect(row.claimId).toBe(claim.id);
    await expect(recordDisasterLoss(userId, r.relief.id, { client, now: LINKED })).rejects.toThrow(
      DisasterError,
    );
    expect(await client.disasterLoss.count({ where: { userId } })).toBe(1);

    const tool = JSON.parse(
      (await runChatTool(userId, "tax_disaster", {}, { client, now: LINKED })).content,
    );
    expect(tool).toMatchObject({ county: "Harris", countyFrom: "seen" });
    expect(tool.relief[0]).toMatchObject({
      deadlinesMoveTo: "2027-05-03",
      sample: true,
      repairsSince: "$36,000.00",
      paidBack: "$8,000.00",
      recordedWithClaim: true,
      insuranceClaim: { carrier: "State Farm" },
    });

    const { reply } = await sendToJane(userId, "can I deduct the flood damage", {
      client,
      now: LINKED,
    });
    expect(reply.body).toMatch(/^Here is the disaster relief for Harris County\./);
    expect(reply.body).toContain("It's recorded with your insurance claim, once.");
  });

  it("checks a county the person names, and tells a county with no relief so", async () => {
    const userId = await person("dis-told");
    const { reply } = await sendToJane(userId, "I live in Travis County", { client, now: LINKED });
    expect(reply.body).toMatch(/^Got it: Travis County\./);
    expect(reply.body).toContain("I don't see a disaster postponement for Travis County");
    expect((await loadDisasterRelief(userId, { client, now: LINKED })).relief).toEqual([]);
  });
});
