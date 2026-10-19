import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { setAutopilot } from "@/lib/autopilot";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { runTaxAutopilot } from "@/lib/tax-autopilot";
import { demoW2 } from "@/lib/tax-docs/demo";
import { collectTaxDocuments, loadTaxDocuments, tickCollected } from "@/lib/tax-documents";
import { buildPackage } from "@/lib/tax-filing";
import { formAmount } from "@/planning/tax-document-check";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { parseActions } from "./types";
import { sendToJane } from "./typing";

// Spec step 166 against a real, migrated Postgres: in February the demo bank's 2026 forms
// collect themselves from the stand-in document partner and are checked against the
// accounts. A form that disagrees is flagged and never used (not ticked off, not handed to
// the filing partner) until the person says it's right.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const FEB = new Date("2027-02-10T16:00:00Z");
const DAY = 86_400_000;
const W2 = "w2:acme-corp-payroll";

describe.runIf(url)("tax documents that collect themselves against a real database", () => {
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

  async function demoPerson(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    return user.id;
  }
  const gather = async (userId: string, now: Date) =>
    taxesSource.gather((await loadSnapshot(userId, { client, now }))!, {
      now,
      local: { date: now.toISOString().slice(0, 10), hour: 8 },
      trigger: "open",
    });
  async function post(userId: string, dedupeKey: string, now: Date) {
    const candidate = (await gather(userId, now)).find((c) => c.dedupeKey === dedupeKey);
    expect(candidate, dedupeKey).toBeDefined();
    return client.janeMessage.create({
      data: {
        userId,
        kind: candidate!.kind,
        body: candidate!.body,
        refs: candidate!.refs,
        actions: candidate!.actions,
        dedupeKey: `taxes:${dedupeKey}`,
      },
    });
  }
  // A paycheck the payroll's W-2 doesn't include: the accounts now disagree with it.
  async function extraPaycheck(userId: string) {
    const checking = await client.account.findFirstOrThrow({
      where: { userId, subtype: "checking" },
    });
    await client.transaction.create({
      data: {
        userId,
        accountId: checking.id,
        source: "plaid",
        date: new Date("2026-06-12T00:00:00Z"),
        amountCents: -245_000,
        description: "ACME CORP PAYROLL",
        merchantName: "ACME CORP PAYROLL",
        pfcDetailed: "INCOME_SALARY",
      },
    });
  }

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

  it("the stand-in's W-2 adds up the pay stubs to exactly the take-home", () => {
    const w2 = demoW2(245_000 * 26);
    expect(formAmount("w2", w2)).toBe(245_000 * 26);
    expect(w2.wages).toBe((395_000 - 23_700 - 14_500) * 26);
    expect(w2.federalWithheld).toBe(56_557 * 26);
  });

  it("collects the forms once a day from late January, checks them, and asks to tick them off", async () => {
    const userId = await demoPerson("tax-docs");
    // Not before the season.
    expect(
      await collectTaxDocuments(userId, {
        client,
        now: new Date("2027-01-10T16:00:00Z"),
        tick: true,
      }),
    ).toEqual({ collected: 0, ticked: 0 });

    expect((await runTaxAutopilot(userId, { client, now: FEB })).documents).toEqual({
      collected: 3,
      ticked: 0,
    });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "system", id: null },
      "tax_document_collected",
      { type: "user", id: userId },
      { year: 2026, form: "w2", partner: "demo" },
    );
    // Once a day.
    expect((await runTaxAutopilot(userId, { client, now: FEB })).documents.collected).toBe(0);

    const view = await loadTaxDocuments(userId, 2026, { client, now: FEB });
    const w2 = view.forms.find((f) => f.key === W2)!;
    expect(w2.check).toEqual({
      status: "matches",
      formCents: w2.amountCents,
      seenCents: w2.amountCents,
      diffCents: 0,
    });
    expect(w2.usable).toBe(true);
    // The lender's 1098 for a past year: nothing in the accounts to check it against.
    expect(view.forms.find((f) => f.formKey === "mortgage")!.check!.status).toBe("unchecked");
    // The brokerage's consolidated 1099 isn't due until Feb 15.
    expect(view.forms.find((f) => f.formKey === "brokerage")!.document).toBeNull();
    expect(view.flagged).toEqual([]);

    const message = await post(userId, "docs:2026:3", FEB);
    expect(message.body).toBe(
      "I collected 3 tax forms for 2026: W-2 from ACME CORP PAYROLL, 1098 from Demo Home Loan and 1098-E from Demo Student Loan. The ones I could check match your accounts. Tick them off?",
    );
    const after = (await takeChatAction(userId, message.id, "tax.docs_tick", { client, now: FEB }))
      .message;
    expect(after.refs.note).toBe("Ticked off 3 forms.");
    expect(
      (await loadTaxDocuments(userId, 2026, { client, now: FEB })).forms
        .filter((f) => f.document)
        .every((f) => f.received),
    ).toBe(true);

    // After Feb 15, the brokerage's form, checked against the dividends.
    const later = new Date(FEB.getTime() + 10 * DAY);
    expect((await collectTaxDocuments(userId, { client, now: later, tick: false })).collected).toBe(
      1,
    );
    const brokerage = (await loadTaxDocuments(userId, 2026, { client, now: later })).forms.find(
      (f) => f.formKey === "brokerage",
    )!;
    expect(brokerage.check!.status).toBe("matches");
  });

  it("flags a form that disagrees with the transactions, and never uses it silently", async () => {
    const userId = await demoPerson("tax-docs-flag");
    await collectTaxDocuments(userId, { client, now: FEB, tick: false });
    await extraPaycheck(userId);

    const view = await loadTaxDocuments(userId, 2026, { client, now: FEB });
    const w2 = view.forms.find((f) => f.key === W2)!;
    expect(w2.check).toMatchObject({ status: "differs", diffCents: -245_000 });
    expect(w2.usable).toBe(false);
    expect(view.flagged.map((f) => f.key)).toEqual([W2]);

    // Not ticked off, not handed to the filing partner.
    expect(await tickCollected(userId, 2026, { client, now: FEB, via: "chat" })).toBe(2);
    expect(
      (await loadTaxDocuments(userId, 2026, { client, now: FEB })).forms.find((f) => f.key === W2)!
        .received,
    ).toBe(false);
    const { pkg } = await buildPackage(userId, 2026, { client, now: FEB });
    expect(pkg.collectedForms!.map((f) => f.form)).toEqual(["1098", "1098-E"]);

    // Flagged in the chat; used only once the person says it's right.
    const message = await post(userId, `doc:2026:${W2}:differs`, FEB);
    expect(message.body).toBe(
      "Your W-2 from ACME CORP PAYROLL for 2026 doesn't match your accounts: it shows take-home pay of $49,000.00, and your accounts show $51,450.00 ($2,450.00 apart). I haven't used it. A deduction taken after tax, like a Roth 401(k), can explain it; otherwise ask them for a corrected form.",
    );
    expect(parseActions(message.actions).map((a) => a.id)).toEqual([
      "tax.doc_right",
      "tax.doc_ask",
      "open",
    ]);
    await takeChatAction(userId, message.id, "tax.doc_right", { client, now: FEB });
    const used = (await loadTaxDocuments(userId, 2026, { client, now: FEB })).forms.find(
      (f) => f.key === W2,
    )!;
    expect(used).toMatchObject({ usable: true, received: true });
    expect(
      (await buildPackage(userId, 2026, { client, now: FEB })).pkg.collectedForms,
    ).toHaveLength(3);
    expect((await gather(userId, FEB)).some((c) => c.dedupeKey.startsWith("doc:"))).toBe(false);
  });

  it("puts asking the payer on the deadlines, and chases a form that's missing", async () => {
    const userId = await demoPerson("tax-docs-ask");
    // The student loan's lender has nothing to send yet.
    await client.liability.updateMany({
      where: { userId, kind: "student" },
      data: { ytdInterestPaidCents: null },
    });
    await setAutopilot(userId, "safe", { client, now: FEB });
    expect((await runTaxAutopilot(userId, { client, now: FEB })).documents).toEqual({
      collected: 2,
      ticked: 2,
    });
    expect((await post(userId, "docs:2026:2", FEB)).body).toMatch(
      /^I collected 2 tax forms for 2026: .+ They match your accounts\. I've ticked them off\.$|^I collected 2 tax forms for 2026: .+ I've ticked them off\.$/,
    );

    const missing = await post(userId, "docmissing:2026:student:demo-student-loan", FEB);
    expect(missing.body).toBe(
      "Your 1098-E from Demo Student Loan for 2026 hasn't come through yet: it was due by Jan 31. I'll keep looking every day. Want a reminder to ask them?",
    );
    await takeChatAction(userId, missing.id, "tax.doc_chase", { client, now: FEB });
    expect(
      await client.deadline.count({
        where: { userId, title: "Ask Demo Student Loan for your 1098-E" },
      }),
    ).toBe(1);

    await extraPaycheck(userId);
    const flagged = await post(userId, `doc:2026:${W2}:differs`, FEB);
    const after = (await takeChatAction(userId, flagged.id, "tax.doc_ask", { client, now: FEB }))
      .message;
    expect(after.refs.note).toBe(
      "Done: asking ACME CORP PAYROLL for a corrected form is on your deadlines. I won't use this one meanwhile.",
    );
    expect(
      await client.deadline.count({
        where: { userId, title: "Ask ACME CORP PAYROLL for a corrected W-2" },
      }),
    ).toBe(1);
    expect(
      (await loadTaxDocuments(userId, 2026, { client, now: FEB })).forms.find((f) => f.key === W2)!
        .usable,
    ).toBe(false);

    const { reply } = await sendToJane(userId, "what tax forms do I need", { client, now: FEB });
    expect(reply.body).toContain(
      "- W-2 from ACME CORP PAYROLL: collected, doesn't match your accounts (not used)",
    );
    const tool = JSON.parse(
      (await runChatTool(userId, "tax_forms", {}, { client, now: FEB })).content,
    );
    expect(tool.collectedByJane).toBe(true);
    expect(tool.forms[0].collected).toMatchObject({ check: "differs", used: false });
  });

  it("doesn't collect for real accounts", async () => {
    const real = await client.user.create({
      data: { email: `tax-docs-real-${crypto.randomUUID()}@example.com` },
    });
    created.push(real.id);
    await client.account.create({
      data: {
        userId: real.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    expect(await collectTaxDocuments(real.id, { client, now: FEB, tick: true })).toEqual({
      collected: 0,
      ticked: 0,
    });
    expect((await loadTaxDocuments(real.id, 2026, { client, now: FEB })).collecting).toBe(false);
  });
});
