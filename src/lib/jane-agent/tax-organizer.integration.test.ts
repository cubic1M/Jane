import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { INSIGHT_MONTHS } from "@/config/insights";
import { loadInsightTransactions } from "@/insights/load";
import { spendingInsights } from "@/insights/spending";
import { setAutopilot } from "@/lib/autopilot";
import { scopedFor } from "@/lib/db-scoped";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import {
  TaxOrganizerError,
  loadTaxForms,
  loadTaxTags,
  markTaxForm,
  setTaxTag,
} from "@/lib/tax-organizer";
import { loadTaxPack } from "@/lib/tax-pack";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { runJaneAgent } from "./run";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { parseActions } from "./types";
import { sendToJane } from "./typing";

// Spec step 119 against a real, migrated Postgres: the demo bank's spending is tagged for
// taxes by itself, tags never change spending totals, the pack matches the tags, the forms
// to expect come from the payers and lenders, and all of it works from the chat.

const url = process.env.TEST_DATABASE_URL;
// 8am in Los Angeles.
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

describe.runIf(url)("the tax organizer against a real database", () => {
  let client: PrismaClient;
  let userId: string;
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
    return id;
  }
  const tap = async (who: string, messageId: string, id: string, now = later()) =>
    (await takeChatAction(who, messageId, id, { client, now })).message;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = await demoPerson("tax-organizer");
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("tags the demo bank's donations, medical and education spending by itself", async () => {
    const view = await loadTaxTags(userId, 2026, { client });
    const payees = (tag: string) => [
      ...new Set(view.tagged.filter((t) => t.tag === tag).map((t) => t.payee)),
    ];
    expect(payees("donation")).toEqual(["American Red Cross"]);
    expect(payees("medical").sort()).toEqual(["BRIGHT SMILES DENTAL", "CVS Pharmacy"]);
    expect(payees("education").sort()).toEqual(["Duolingo", "MasterClass"]);
    expect(view.totals.work.count).toBe(0);
    // Jane isn't sure online courses count, so she asks.
    expect(view.checks.map((c) => c.payee)).toEqual(["MasterClass", "Duolingo"]);
  });

  it("tags never change spending totals, and the pack matches the tags", async () => {
    const asOf = LINKED.toISOString().slice(0, 10);
    const spending = async () =>
      spendingInsights(
        await loadInsightTransactions(scopedFor(userId, client), asOf, INSIGHT_MONTHS),
        { asOf, monthCount: INSIGHT_MONTHS },
      );
    const before = JSON.stringify(await spending());
    await setTaxTag(userId, { merchantKey: "starbucks" }, "work", { client, via: "page" });
    const dentist = (await loadTaxTags(userId, 2026, { client })).tagged.find((t) =>
      t.payee.startsWith("BRIGHT"),
    )!;
    await setTaxTag(userId, { transactionId: dentist.id }, null, { client, via: "page" });
    expect(JSON.stringify(await spending())).toBe(before);

    const [tags, pack] = await Promise.all([
      loadTaxTags(userId, 2026, { client }),
      loadTaxPack(userId, 2026, { client, now: LINKED }),
    ]);
    expect(pack.charity.totalCents).toBe(tags.totals.donation.totalCents);
    expect(pack.preparer.medical.totalCents).toBe(tags.totals.medical.totalCents);
    expect(pack.preparer.education.totalCents).toBe(tags.totals.education.totalCents);
    expect(pack.preparer.work.rows.length).toBe(tags.totals.work.count);
    expect(
      pack.preparer.work.rows.every((r) => r.payee === "Starbucks" && r.source === "yours"),
    ).toBe(true);
    expect(pack.preparer.medical.rows.some((r) => r.id === dentist.id)).toBe(false);
  });

  it("only tags the person's own transactions and merchants", async () => {
    const otherId = await person("tax-organizer-other");
    const mine = (await loadTaxTags(userId, 2026, { client })).tagged[0];
    await expect(
      setTaxTag(otherId, { transactionId: mine.id }, "work", { client, via: "page" }),
    ).rejects.toBeInstanceOf(TaxOrganizerError);
    await expect(
      setTaxTag(otherId, { merchantKey: "starbucks" }, "work", { client, via: "page" }),
    ).rejects.toThrow("no charges");
    expect(await client.taxTag.count({ where: { userId: otherId } })).toBe(0);
  });

  it("expects the W-2, the brokerage form and the loan interest forms", async () => {
    const { forms } = await loadTaxForms(userId, 2026, { client, now: LINKED });
    expect(forms.map((f) => [f.form, f.from])).toEqual([
      ["W-2", "ACME CORP PAYROLL"],
      ["consolidated 1099 (DIV and B)", "Demo Brokerage"],
      ["1098", "Demo Home Loan"],
      ["1098-E", "Demo Student Loan"],
    ]);
    const w2 = forms[0];
    await markTaxForm(userId, 2026, w2.key, true, { client, now: LINKED, via: "page" });
    expect((await loadTaxForms(userId, 2026, { client, now: LINKED })).forms[0].received).toBe(
      true,
    );
    await expect(
      markTaxForm(userId, 2026, "w2:someone-else", true, { client, now: LINKED, via: "page" }),
    ).rejects.toThrow("isn't on your list");
    await markTaxForm(userId, 2026, w2.key, false, { client, now: LINKED, via: "page" });
    expect((await loadTaxForms(userId, 2026, { client, now: LINKED })).forms[0].received).toBe(
      false,
    );
  });

  it("asks about a merchant it isn't sure of, and No untags every charge from it", async () => {
    const snapshot = await loadSnapshot(userId, { client, now: LINKED });
    const candidates = taxesSource.gather(snapshot!, {
      now: LINKED,
      local: { date: "2026-10-18", hour: 8 },
      trigger: "open",
    });
    const check = candidates.find((c) => c.dedupeKey === "check:masterclass")!;
    expect(check.body).toBe(
      "I've tagged MasterClass ($121.00 this year) as education for your taxes. Is that right?",
    );
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: check.kind,
        body: check.body,
        refs: check.refs,
        actions: check.actions,
        dedupeKey: `taxes:${check.dedupeKey}`,
      },
    });
    const after = await tap(userId, message.id, "tax.tag_no");
    expect(after.refs.note).toBe("OK, untagged. I'll leave charges from there out of your taxes.");
    const view = await loadTaxTags(userId, 2026, { client });
    expect(view.tagged.some((t) => t.payee === "MasterClass")).toBe(false);
    expect(view.checks.map((c) => c.payee)).toEqual(["Duolingo"]);
  });

  it("tells you each month what it tagged, at the levels that let it act", async () => {
    const context = {
      now: LINKED,
      local: { date: "2026-10-18", hour: 8 },
      trigger: "open" as const,
    };
    const ask = await loadSnapshot(userId, { client, now: LINKED });
    expect(taxesSource.gather(ask!, context).some((c) => c.dedupeKey.startsWith("month:"))).toBe(
      false,
    );
    await setAutopilot(userId, "safe", { client, now: LINKED });
    const safe = await loadSnapshot(userId, { client, now: LINKED });
    const month = taxesSource.gather(safe!, context).find((c) => c.dedupeKey === "month:2026-09")!;
    expect(month.kind).toBe("done");
    expect(month.body).toMatch(/^In September I tagged \d+ things for your taxes: /);
    expect(month.body).toContain("They're in your tax-time pack.");
    await setAutopilot(userId, "ask", { client, now: LINKED });
  });

  it("answers typed questions about tags, forms and the pack, and tags only on a tap", async () => {
    const donated = await sendToJane(userId, "how much have I donated this year", {
      client,
      now: later(),
    });
    expect(donated.reply.body).toBe(
      "You've given $100.00 to charity in 2026 so far, by my tax tags (2): American Red Cross $100.00. It's all in your tax-time pack.",
    );

    const forms = await sendToJane(userId, "what tax forms should I expect", {
      client,
      now: later(),
    });
    expect(forms.reply.body).toContain(
      "- W-2 from ACME CORP PAYROLL: usually sent by Jan 31, 2027",
    );

    const pack = await sendToJane(userId, "my tax pack", { client, now: later() });
    expect(pack.reply.body).toContain("Your 2026 tax-time pack has donations $100.00");
    expect(parseActions(pack.reply.actions).map((a) => a.label)).toEqual([
      "Open the tax-time pack",
      "Download the spreadsheet",
    ]);

    const tag = await sendToJane(userId, "tag Shell as work", { client, now: later() });
    expect(tag.reply.body).toMatch(
      /^Want me to tag your \d+ Shell charges this year \(\$[\d,.]+\) as work expenses\?/,
    );
    expect(await client.taxTag.count({ where: { userId, merchantKey: "shell oil" } })).toBe(0);
    const after = await tap(userId, tag.reply.id, "tax.tag_set");
    expect(after.refs.note).toMatch(
      /^Done: \d+ charges tagged work expense, and new ones will be too\.$/,
    );
    expect((await loadTaxTags(userId, 2026, { client })).totals.work.count).toBeGreaterThan(0);

    const missing = await sendToJane(userId, "tag Narnia Books as work", { client, now: later() });
    expect(missing.reply.body).toBe(
      'I couldn\'t find charges from "narnia books" in 2026. You can search for it on your tax tags.',
    );
  });

  it("asks from late January whether each form has arrived, and I have it ticks it off", async () => {
    const january = new Date("2027-01-21T16:00:00Z");
    const snapshot = await loadSnapshot(userId, { client, now: january });
    const due = taxesSource
      .gather(snapshot!, { now: january, local: { date: "2027-01-21", hour: 8 }, trigger: "open" })
      .filter((c) => c.dedupeKey.startsWith("form:2026:"));
    expect(due.map((c) => c.body)).toContain(
      "Your W-2 from ACME CORP PAYROLL for 2026 is usually sent by Jan 31. Have you got it?",
    );
    const w2 = due.find((c) => c.refs.taxForm?.startsWith("w2:"))!;
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: w2.kind,
        body: w2.body,
        refs: w2.refs,
        actions: w2.actions,
        dedupeKey: `taxes:${w2.dedupeKey}`,
      },
    });
    const after = await tap(userId, message.id, "tax.form_got", january);
    expect(after.refs.note).toBe(
      "Ticked off: W-2 from ACME CORP PAYROLL. Keep it with your tax papers.",
    );
    const again = taxesSource.gather((await loadSnapshot(userId, { client, now: january }))!, {
      now: january,
      local: { date: "2027-01-21", hour: 8 },
      trigger: "open",
    });
    expect(again.some((c) => c.refs.taxForm === w2.refs.taxForm)).toBe(false);
    // Outside late January to mid-April, Jane doesn't ask.
    expect(
      taxesSource
        .gather((await loadSnapshot(userId, { client, now: LINKED }))!, {
          now: LINKED,
          local: { date: "2026-10-18", hour: 8 },
          trigger: "open",
        })
        .some((c) => c.dedupeKey.startsWith("form:")),
    ).toBe(false);
  });

  it("gives Claude the tags and forms, with figures recorded", async () => {
    const tags = await runChatTool(
      userId,
      "tax_tags",
      { tag: "donation" },
      { client, now: LINKED },
    );
    const data = JSON.parse(tags.content);
    expect(data.year).toBe(2026);
    expect(data.transactions).toHaveLength(2);
    expect(data.transactions[0]).toMatchObject({ payee: "American Red Cross", taggedBy: "Jane" });
    expect(tags.cents).toContain(5_000);
    const forms = JSON.parse(
      (await runChatTool(userId, "tax_forms", {}, { client, now: LINKED })).content,
    );
    expect(forms.forms[0]).toMatchObject({ form: "W-2", from: "ACME CORP PAYROLL" });
  });

  it("runs in the chat without errors after a sync", async () => {
    await runJaneAgent(userId, { client, now: new Date(LINKED.getTime() + DAY), trigger: "sync" });
  });
});
