import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { familyLoansSource } from "@/lib/jane-agent/sources/family-loans";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseActions, parseRefs } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import {
  FamilyLoanError,
  addCosignedLoan,
  confirmFamilyLoan,
  dismissFamilyLoan,
  loadFamilyLoans,
  refreshFamilyLoans,
  settleFamilyLoan,
} from "./family-loans";

// Spec step 226 against a real, migrated Postgres, on the demo bank with payment-app transfers
// added: a transfer is a loan only after the person says so, repayments are matched from the
// transfers that come back, a kind reminder is drafted for the person to send, Jane never
// messages the other person, and co-signed loans are watched.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("family and friends against a real database", { timeout: 120_000 }, () => {
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
  const later = () => new Date(LINKED.getTime() + ++tick * MINUTE);
  const opts = (now = LINKED) => ({ client, now });
  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }
  async function transfer(userId: string, date: string, amountCents: number, description: string) {
    const checking = await client.account.findFirstOrThrow({
      where: { userId, subtype: "checking" },
    });
    return client.transaction.create({
      data: {
        userId,
        accountId: checking.id,
        source: "plaid",
        date: new Date(`${date}T00:00:00Z`),
        amountCents,
        description,
        pfcPrimary: amountCents > 0 ? "TRANSFER_OUT" : "TRANSFER_IN",
        pfcDetailed:
          amountCents > 0 ? "TRANSFER_OUT_ACCOUNT_TRANSFER" : "TRANSFER_IN_ACCOUNT_TRANSFER",
      },
    });
  }
  async function demoPerson(prefix: string) {
    const id = await person(prefix);
    const { itemId } = await linkDemoBank(id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
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

  it("asks about a big transfer once, and it's a loan only after the person says so", async () => {
    const id = await demoPerson("fam-ask");
    const tx = await transfer(id, "2026-10-03", 40_000, "VENMO PAYMENT TO JORDAN LEE - rent loan");
    await transfer(id, "2026-10-05", 2_500, "VENMO PAYMENT TO JORDAN LEE - lunch");
    const data = await loadFamilyLoans(id, opts());
    expect(data.candidates.map((c) => c.id)).toEqual([`tx:${tx.id}`]);
    expect(data.loans).toEqual([]);
    expect(await client.personalLoan.count({ where: { userId: id } })).toBe(0);
    const snapshot = (await loadSnapshot(id, opts()))!;
    const [ask] = familyLoansSource.gather(snapshot, context);
    expect(ask.kind).toBe("decision");
    expect(ask.body).toContain("You sent Jordan Lee $400.00 on Venmo on Oct 3");
    expect(ask.body).toContain("I won't contact Jordan");
    expect(ask.actions.slice(0, 2).map((a) => a.id)).toEqual(["famloan.yes", "famloan.no"]);
  });

  it("confirms a loan on a tap, then counts what comes back and settles it when it's all back", async () => {
    const id = await demoPerson("fam-yes");
    const tx = await transfer(id, "2026-10-03", 40_000, "VENMO PAYMENT TO JORDAN LEE - rent loan");
    const { reply } = await sendToJane(id, "who owes me money?", { client, now: later() });
    expect(reply.body).toContain("You sent Jordan Lee $400.00 on Venmo");
    expect(
      parseActions(reply.actions)
        .slice(0, 2)
        .map((a) => a.id),
    ).toEqual(["famloan.yes", "famloan.no"]);
    const tapped = await takeChatAction(id, reply.id, "famloan.yes", { client, now: later() });
    expect(tapped.message.refs.note).toMatch(/^Noted: Jordan Lee owes you \$400\.00\./);
    expect(tapped.message.refs.note).toContain("I won't message Jordan");
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      { type: "user", id },
      "personal_loan_confirmed",
      expect.objectContaining({ type: "personal_loan" }),
      { kind: "lent" },
    );
    await expect(confirmFamilyLoan(id, `tx:${tx.id}`, opts())).rejects.toThrow(FamilyLoanError);
    // Jordan sends $150 back.
    await transfer(id, "2026-10-12", -15_000, "ZELLE FROM JORDAN LEE - paying you back");
    const part = await loadFamilyLoans(id, opts());
    expect(part.loans[0]).toMatchObject({
      counterparty: "Jordan Lee",
      principalCents: 40_000,
      balanceCents: 25_000,
    });
    expect(part.loans[0].repaid).toEqual([{ date: "2026-10-12", cents: 15_000 }]);
    expect(part.candidates).toEqual([]);
    expect(await refreshFamilyLoans(id, opts())).toBe(0);
    await transfer(id, "2026-10-15", -25_000, "VENMO FROM JORDAN LEE");
    expect(await refreshFamilyLoans(id, opts())).toBe(1);
    const done = await loadFamilyLoans(id, opts());
    expect(done.loans).toEqual([]);
    expect(done.settled[0]).toMatchObject({ counterparty: "Jordan Lee", principalCents: 40_000 });
  });

  it("drops a transfer that wasn't a loan, for good", async () => {
    const id = await demoPerson("fam-no");
    await transfer(id, "2026-10-06", 12_000, "VENMO PAYMENT TO ALEX KIM");
    const { reply } = await sendToJane(id, "money I lent", { client, now: later() });
    const tapped = await takeChatAction(id, reply.id, "famloan.no", { client, now: later() });
    expect(tapped.message.refs.note).toBe("Got it: not a loan, and I won't ask about it again.");
    expect((await loadFamilyLoans(id, opts())).candidates).toEqual([]);
    expect((await loadFamilyLoans(id, opts())).loans).toEqual([]);
    await expect(dismissFamilyLoan(id, "tx:nothing", opts())).rejects.toThrow(FamilyLoanError);
  });

  it("drafts a kind reminder for the person to send once a loan has been open a month, and never sends it", async () => {
    const id = await demoPerson("fam-remind");
    const tx = await transfer(id, "2026-09-03", 40_000, "VENMO PAYMENT TO JORDAN LEE - rent loan");
    await confirmFamilyLoan(id, `tx:${tx.id}`, opts());
    const soon = await loadFamilyLoans(id, opts(new Date("2026-09-20T15:00:00Z")));
    expect(soon.loans[0].reminder).toBeNull();
    const data = await loadFamilyLoans(id, opts());
    expect(data.loans[0].daysOpen).toBe(45);
    expect(data.loans[0].reminder!.text).toContain("Hi Jordan");
    const snapshot = (await loadSnapshot(id, opts()))!;
    const remind = familyLoansSource
      .gather(snapshot, context)
      .find((c) => c.dedupeKey.startsWith("famremind:"))!;
    expect(remind.body).toContain("here's a kind note you can send yourself");
    expect(remind.body).toContain("I won't message Jordan");
    // Nothing was sent anywhere.
    expect(await client.action.count({ where: { userId: id } })).toBe(0);
    expect(await client.agentMessage.count({ where: { userId: id } })).toBe(0);
  });

  it("watches a co-signed loan for a late payment", async () => {
    const id = await demoPerson("fam-cosign");
    const before = await loadFamilyLoans(id, opts());
    const student = before.cosignable.find((d) => d.name.includes("Student"))!;
    await expect(
      addCosignedLoan(id, { debtKey: student.debtKey, counterparty: "" }, opts()),
    ).rejects.toThrow(FamilyLoanError);
    await expect(
      addCosignedLoan(id, { debtKey: "account:nothing", counterparty: "Sam" }, opts()),
    ).rejects.toThrow(FamilyLoanError);
    await addCosignedLoan(id, { debtKey: student.debtKey, counterparty: "Sam Rivera" }, opts());
    const ok = await loadFamilyLoans(id, opts());
    expect(ok.cosigned[0]).toMatchObject({ counterparty: "Sam Rivera", missed: false });
    // The payment goes late.
    await client.liability.updateMany({
      where: { userId: id, kind: "student" },
      data: { isOverdue: true, pastDueCents: 19_500 },
    });
    const late = await loadFamilyLoans(id, opts());
    expect(late.cosigned[0].missed).toBe(true);
    expect(late.cosigned[0].text).toContain("Hi Sam");
    const snapshot = (await loadSnapshot(id, opts()))!;
    const warn = familyLoansSource
      .gather(snapshot, context)
      .find((c) => c.dedupeKey.startsWith("cosigned:"))!;
    expect(warn.body).toContain("you co-signed for Sam Rivera looks late");
    expect(warn.body).toContain("I won't message them");
  });

  it("settles a loan by hand, answers who owes whom, and gives Claude the same", async () => {
    const id = await demoPerson("fam-tool");
    const tx = await transfer(id, "2026-10-03", 40_000, "VENMO PAYMENT TO JORDAN LEE - rent loan");
    await confirmFamilyLoan(id, `tx:${tx.id}`, opts());
    const { reply } = await sendToJane(id, "who owes me?", { client, now: later() });
    expect(reply.body).toMatch(/^People who owe you \$400\.00:/);
    const tool = JSON.parse((await runChatTool(id, "family_loans", {}, opts())).content);
    expect(tool.janeNeverMessagesTheOtherPerson).toBe(true);
    expect(tool.loans[0].stillOwed).toBe("$400.00");
    const loan = await client.personalLoan.findFirstOrThrow({ where: { userId: id } });
    await settleFamilyLoan(id, loan.id, opts());
    await expect(settleFamilyLoan(id, loan.id, opts())).rejects.toThrow(FamilyLoanError);
    expect((await loadFamilyLoans(id, opts())).loans).toEqual([]);
  });

  it("is private to the person", async () => {
    const a = await demoPerson("fam-a");
    const b = await demoPerson("fam-b");
    const tx = await transfer(a, "2026-10-03", 40_000, "VENMO PAYMENT TO JORDAN LEE - rent loan");
    await confirmFamilyLoan(a, `tx:${tx.id}`, opts());
    expect((await loadFamilyLoans(b, opts())).loans).toEqual([]);
    expect((await loadFamilyLoans(b, opts())).candidates).toEqual([]);
  });
});
