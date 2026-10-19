import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { BILL_PAY_MIN_LEFT_CENTS } from "@/config/money-movement";
import { loadDetectionInput } from "@/detection/engine";
import { forecastAccounts } from "@/detection/forecast";
import { logAudit } from "@/lib/audit";
import { setAutopilot } from "@/lib/autopilot";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { answerByRules } from "@/lib/jane-agent/answer";
import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { postMessages } from "@/lib/jane-agent/messages";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { billPaySource } from "@/lib/jane-agent/sources/billpay";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { setSectorAutopilot } from "@/lib/sector-autopilot";
import { BillPayError, loadBillPay, payBill, runBillPay } from "./bill-pay";
import { listTransfers } from "./transfers";

// Spec step 145 against a real, migrated Postgres, with the demo bank: Jane leaves bills the
// person's own autopay covers alone; pays a card nothing covers a couple of days early,
// by herself within Subscriptions and bills' autopilot caps or with one tap; never
// schedules a payment that would take checking's forecast below its cushion; and, when a
// bill lands before payday and checking runs short, suggests moving the due date.

const url = process.env.TEST_DATABASE_URL;
// The day after the demo bank's mid-month payroll; its card is due on the 26th.
const LINKED = new Date("2026-10-16T15:00:00Z");

describe.runIf(url)("bills paid on time", { timeout: 120_000 }, () => {
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

  async function demoPerson(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api, now: LINKED });
    // Sectors' own levels count once autopilot is on.
    await setAutopilot(user.id, "safe", { client, now: LINKED });
    return user.id;
  }

  // The demo card's own autopay from checking, gone: nothing covers the card's bill.
  async function noCardAutopay(userId: string) {
    await client.transaction.deleteMany({
      where: { userId, description: "PAYMENT TO DEMO CARD" },
    });
    await client.recurringStream.deleteMany({
      where: { userId, pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" },
    });
  }

  // Checking with room for the card's whole balance on every forecast day, so the tests
  // don't hang on the demo's own margins.
  const plentyInChecking = (userId: string) =>
    client.account.updateMany({
      where: { userId, subtype: "checking" },
      data: { currentBalanceCents: 1_000_000 },
    });

  const card = async (userId: string) =>
    (await loadBillPay(userId, { client, now: LINKED })).items.find(
      (i) => i.bill.name === "Demo Credit Card",
    )!;

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

  it("leaves bills the person's own autopay covers alone", async () => {
    const userId = await demoPerson("bills-autopay");
    await setSectorAutopilot(
      userId,
      "bills",
      { level: "all", actionCapCents: 500_000 },
      {
        client,
        now: LINKED,
      },
    );
    const view = await loadBillPay(userId, { client, now: LINKED });
    expect(view.items.map((i) => [i.bill.name, i.status])).toEqual(
      expect.arrayContaining([
        ["Demo Credit Card", "autopay"],
        ["Demo Student Loan", "autopay"],
      ]),
    );
    expect(view.items.every((i) => i.status === "autopay")).toBe(true);
    expect(await runBillPay(userId, { client, now: LINKED })).toBe(0);
    expect(await client.moneyTransfer.count({ where: { userId } })).toBe(0);
  });

  it("pays a card nothing covers by itself, within the caps, without overdrawing", async () => {
    const userId = await demoPerson("bills-auto");
    await noCardAutopay(userId);
    await plentyInChecking(userId);
    // Over the cap: it waits for a tap.
    await setSectorAutopilot(
      userId,
      "bills",
      { level: "all", actionCapCents: 1_000, monthlyCapCents: 1_000 },
      { client, now: LINKED },
    );
    expect(await runBillPay(userId, { client, now: LINKED })).toBe(0);
    expect((await card(userId)).status).toBe("ask");

    await setSectorAutopilot(
      userId,
      "bills",
      { actionCapCents: 300_000, monthlyCapCents: 300_000 },
      { client, now: LINKED },
    );
    expect(await runBillPay(userId, { client, now: LINKED })).toBe(1);
    const [transfer] = await listTransfers(userId, { client, now: LINKED });
    expect(transfer).toMatchObject({
      toName: "Demo Credit Card",
      // The whole balance, since checking can take it.
      amountCents: 241_050,
      purpose: "bill",
      status: "pending",
      by: "autopilot",
      runOn: "2026-10-24",
      undoable: true,
    });
    // Never below the cushion on any forecast day from the payment on.
    const input = await loadDetectionInput(userId, { client, now: LINKED });
    const checking = forecastAccounts(input, 30).find((f) => f.accountName.match(/Checking/))!;
    const after = checking.days.filter((d) => d.date >= "2026-10-24");
    expect(
      Math.min(...after.map((d) => d.balanceCents)) - transfer.amountCents,
    ).toBeGreaterThanOrEqual(BILL_PAY_MIN_LEFT_CENTS);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "money_transfer_scheduled",
      { type: "money_transfer", id: transfer.id },
      expect.objectContaining({ by: "autopilot", purpose: "bill", simulated: true }),
    );
    // Once.
    expect(await runBillPay(userId, { client, now: LINKED })).toBe(0);
    expect((await card(userId)).status).toBe("scheduled");

    const snapshot = await loadSnapshot(userId, { client, now: LINKED });
    const [said] = gather(snapshot!, LINKED, { trigger: "open", sources: [billPaySource] });
    expect(said).toMatchObject({ kind: "done" });
    expect(said.body).toMatch(/by myself \(autopilot\), so it lands on time/);
  });

  it("asks with one tap when bills ask first, and the tap schedules it once", async () => {
    const userId = await demoPerson("bills-ask");
    await noCardAutopay(userId);
    await plentyInChecking(userId);
    await setSectorAutopilot(userId, "bills", { level: "ask" }, { client, now: LINKED });
    expect(await runBillPay(userId, { client, now: LINKED })).toBe(0);

    const snapshot = await loadSnapshot(userId, { client, now: LINKED });
    await postMessages(
      userId,
      gather(snapshot!, LINKED, { trigger: "open", sources: [billPaySource] }),
      { client, now: LINKED },
    );
    const message = await client.janeMessage.findFirstOrThrow({
      where: { userId, dedupeKey: { startsWith: "billpay:" } },
    });
    expect(message.kind).toBe("decision");
    expect(message.body).toMatch(
      /^Your Demo Credit Card payment is due Oct 26 \(in 10 days\)\. Nothing is set to pay it yet\./,
    );
    const { message: answered } = await takeChatAction(userId, message.id, "bill.pay", {
      client,
      now: LINKED,
    });
    expect(answered.refs.note).toMatch(/^Done\. \$[\d,]+\.\d\d goes to Demo Credit Card on Oct 24/);
    const [transfer] = await listTransfers(userId, { client, now: LINKED });
    expect(transfer).toMatchObject({ purpose: "bill", by: "person", status: "pending" });
    const { planKey } = await card(userId);
    await expect(
      payBill(userId, planKey, "person", { client, now: LINKED }),
    ).rejects.toBeInstanceOf(BillPayError);

    expect(
      (await answerByRules(userId, { kind: "bills_paid" }, { client, now: LINKED }))?.body,
    ).toMatch(/Demo Credit Card, due Oct 26: \$[\d,]+\.\d\d scheduled for Oct 24\./);
    const tool = JSON.parse(
      (await runChatTool(userId, "money_moves", {}, { client, now: LINKED })).content,
    );
    expect(tool.bills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Demo Credit Card",
          status: "scheduled",
          on: "2026-10-24",
        }),
      ]),
    );
  });

  it("never pays when checking would run short, and suggests moving a due date before payday", async () => {
    const userId = await demoPerson("bills-short");
    await noCardAutopay(userId);
    await setSectorAutopilot(
      userId,
      "bills",
      { level: "all", actionCapCents: 500_000 },
      {
        client,
        now: LINKED,
      },
    );
    await client.account.updateMany({
      where: { userId, subtype: "checking" },
      data: { currentBalanceCents: 5_000 },
    });
    const view = await loadBillPay(userId, { client, now: LINKED });
    const item = view.items.find((i) => i.bill.name === "Demo Credit Card")!;
    expect(item.status).toBe("short");
    expect(view.payday).not.toBeNull();
    expect(item).toMatchObject({ moveTo: expect.any(String) });
    expect(item.status === "short" && item.moveTo! > view.payday!).toBe(true);
    expect(await runBillPay(userId, { client, now: LINKED })).toBe(0);
    await expect(
      payBill(userId, item.planKey, "person", { client, now: LINKED }),
    ).rejects.toBeInstanceOf(BillPayError);
    expect(await client.moneyTransfer.count({ where: { userId } })).toBe(0);

    const snapshot = await loadSnapshot(userId, { client, now: LINKED });
    const said = gather(snapshot!, LINKED, { trigger: "open", sources: [billPaySource] }).find(
      (c) => c.body.includes("Demo Credit Card"),
    )!;
    expect(said.kind).toBe("heads_up");
    expect(said.body).toMatch(/ask the lender to move your due date to \w{3} \d+ or later/);
  });

  it("never pays bills for real accounts", async () => {
    const real = await client.user.create({
      data: { email: `bills-real-${crypto.randomUUID()}@example.com` },
    });
    created.push(real.id);
    expect(await runBillPay(real.id, { client, now: LINKED })).toBe(0);
    expect(
      (await answerByRules(real.id, { kind: "bills_paid" }, { client, now: LINKED }))?.body,
    ).toMatch(/needs a money-movement partner/);
  });
});
