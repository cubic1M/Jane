import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { BUFFER_FLOOR_MONTHS } from "@/config/steady-pay";
import { setAutopilot } from "@/lib/autopilot";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { answerByRules } from "@/lib/jane-agent/answer";
import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { postMessages } from "@/lib/jane-agent/messages";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { steadySource } from "@/lib/jane-agent/sources/steady";
import { listTransfers } from "@/lib/money-movement/transfers";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { setSectorAutopilot } from "@/lib/sector-autopilot";
import { loadSteady, payNow, runSteadyPay, SteadyError } from "./steady-pay";

// Spec step 240 against a real, migrated Postgres, with the demo bank and a year of uneven
// freelance deposits: each deposit's tax share and the rest to the buffer, one steady
// paycheck a month from the buffer to checking, never under the floor, by autopilot within
// its caps or on the person's tap.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-16T15:00:00Z");
const day = (d: string) => new Date(`${d}T00:00:00Z`);
const DEPOSITS = [
  ["2026-04-10", 520_000],
  ["2026-05-06", 90_000],
  ["2026-06-20", 780_000],
  ["2026-07-15", 0],
  ["2026-08-03", 610_000],
  ["2026-09-12", 340_000],
  ["2026-10-14", 450_000],
] as const;

describe.runIf(url)("a steady paycheck from uneven income", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const api = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no Plaid");
      },
    },
  ) as PlaidApi;

  async function freelancer(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW });
    await syncItem(itemId, { client, api, now: NOW });
    await setAutopilot(user.id, "safe", { client, now: NOW });
    // Room in Goals' caps for a month's paycheck and the deposits' moves.
    await setSectorAutopilot(
      user.id,
      "goals",
      { level: "safe", actionCapCents: 2_000_000, monthlyCapCents: 5_000_000 },
      { client, now: NOW },
    );
    await setSectorAutopilot(
      user.id,
      "taxes",
      { level: "safe", actionCapCents: 2_000_000, monthlyCapCents: 5_000_000 },
      { client, now: NOW },
    );
    const checking = await client.account.findFirstOrThrow({
      where: { userId: user.id, subtype: "checking" },
    });
    for (const [date, cents] of DEPOSITS) {
      if (cents === 0) continue;
      await client.transaction.create({
        data: {
          userId: user.id,
          accountId: checking.id,
          source: "plaid",
          date: day(date),
          amountCents: -cents,
          description: "ACME DESIGN INVOICE",
          pfcPrimary: "INCOME",
          pfcDetailed: "INCOME_CONTRACTOR",
        },
      });
    }
    return user.id;
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("sees uneven income, sets aside each deposit and sends one steady paycheck a month", async () => {
    const userId = await freelancer("steady-auto");
    const view = (await loadSteady(userId, { client, now: NOW }))!;
    expect(view.uneven).toBe(true);
    expect(view.plan).toMatchObject({ status: "ready" });
    // The paycheck never takes the buffer under its floor.
    expect(view.plan!.paycheckCents).toBeLessThanOrEqual(
      Math.max(0, view.bufferCents - view.plan!.floorCents),
    );
    expect(view.plan!.floorCents).toBeGreaterThan(0);
    void BUFFER_FLOOR_MONTHS;

    const ran = await runSteadyPay(userId, { client, now: NOW });
    expect(ran.paycheck).toBe("sent");
    const transfers = await listTransfers(userId, { client, now: NOW });
    const steady = transfers.filter((t) => t.toName.startsWith("Checking (your steady"));
    expect(steady).toHaveLength(1);
    expect(steady[0]).toMatchObject({
      by: "autopilot",
      status: "pending",
      amountCents: view.plan!.paycheckCents,
    });
    // The recent deposit's tax share and the rest were moved, once each.
    expect(
      transfers
        .filter((t) => t.toName === "Taxes set aside" || t.toName === "Buffer")
        .map((t) => t.toName)
        .sort(),
    ).toEqual(["Buffer", "Taxes set aside"]);
    // Once a month, and once a deposit.
    const again = await runSteadyPay(userId, { client, now: NOW });
    expect(again.paycheck).toBe("none");
    expect(
      await client.moneyTransfer.count({ where: { userId, planKey: { startsWith: "steady:" } } }),
    ).toBe(1);
    await expect(payNow(userId, "person", { client, now: NOW })).rejects.toBeInstanceOf(
      SteadyError,
    );

    // Said in the chat, and for Claude.
    const reply = await answerByRules(userId, { kind: "steady_pay" }, { client, now: NOW });
    expect(reply?.body).toMatch(
      /^Your steady paycheck is \$[\d,]+\.\d\d a month, from the buffer in your savings to checking\./,
    );
    expect(reply?.body).toContain("went by itself (autopilot)");
    const tool = JSON.parse(
      (await runChatTool(userId, "steady_pay", {}, { client, now: NOW })).content,
    );
    expect(tool.unevenIncome).toBe(true);
    expect(tool.thisMonthSent.by).toBe("autopilot");
  });

  it("asks with one tap when the area always asks, and the tap sends it once", async () => {
    const userId = await freelancer("steady-ask");
    await setSectorAutopilot(userId, "goals", { level: "ask" }, { client, now: NOW });
    expect((await runSteadyPay(userId, { client, now: NOW })).paycheck).toBe("asked");
    expect(
      await client.moneyTransfer.count({ where: { userId, planKey: { startsWith: "steady:" } } }),
    ).toBe(0);
    const snapshot = (await loadSnapshot(userId, { client, now: NOW }))!;
    await postMessages(
      userId,
      gather(snapshot, NOW, { trigger: "open", sources: [steadySource] }),
      { client, now: NOW },
    );
    const message = await client.janeMessage.findFirstOrThrow({
      where: { userId, dedupeKey: { startsWith: "steady:" } },
    });
    expect(message.kind).toBe("decision");
    const { message: answered } = await takeChatAction(userId, message.id, "steady.pay", {
      client,
      now: NOW,
    });
    expect(answered.refs.note).toMatch(
      /^Done\. \$[\d,]+\.\d\d goes from your buffer to checking on 2026-10-17/,
    );
    expect(
      await client.moneyTransfer.count({
        where: { userId, planKey: { startsWith: "steady:" }, by: "person" },
      }),
    ).toBe(1);
  });

  it("does nothing for someone with steady pay, and nothing for a real account", async () => {
    const steadyPerson = await client.user.create({
      data: { email: `steady-none-${crypto.randomUUID()}@example.com` },
    });
    created.push(steadyPerson.id);
    const { itemId } = await linkDemoBank(steadyPerson.id, { client, now: NOW });
    await syncItem(itemId, { client, api, now: NOW });
    expect((await loadSteady(steadyPerson.id, { client, now: NOW }))!.uneven).toBe(false);
    expect((await runSteadyPay(steadyPerson.id, { client, now: NOW })).paycheck).toBe("none");
    const real = await client.user.create({
      data: { email: `steady-real-${crypto.randomUUID()}@example.com` },
    });
    created.push(real.id);
    expect(await runSteadyPay(real.id, { client, now: NOW })).toEqual({
      deposits: 0,
      paycheck: "none",
    });
  });
});
