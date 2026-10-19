import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import {
  TaxProfileError,
  addIncomeKind,
  confirmFound,
  loadTaxProfile,
  loadWorkingProfile,
  saveTaxAnswers,
} from "@/lib/tax-profile";
import { setAutopilot } from "@/lib/autopilot";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { runJaneAgent } from "./run";
import { parseActions, parseRefs } from "./types";
import { sendToJane } from "./typing";

// Spec step 118 against a real, migrated Postgres: the demo bank's income and state are
// found and shown as found; the chat asks the rest one question at a time in one message;
// typed answers only offer a button; the profile page's rules hold; another person can't
// touch it.

const url = process.env.TEST_DATABASE_URL;
// 8am in Los Angeles (the default timezone).
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;

describe.runIf(url)("the tax profile against a real database", () => {
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

  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }
  async function demoPerson(prefix: string) {
    const userId = await person(prefix);
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    return userId;
  }
  // Jane posts at most a few messages a day, the most important first: the tax questions
  // come within the first days of the demo bank.
  async function talkUntil(userId: string, dedupeKey: string) {
    for (let day = 0; day < 7; day += 1) {
      await runJaneAgent(userId, {
        client,
        now: new Date(LINKED.getTime() + day * 24 * 60 * MINUTE),
        trigger: "open",
      });
      if (await client.janeMessage.count({ where: { userId, dedupeKey } })) return;
    }
    throw new Error(`Jane never posted ${dedupeKey}`);
  }
  const profileMessage = (userId: string) =>
    client.janeMessage.findFirstOrThrow({ where: { userId, dedupeKey: "taxes:profile" } });
  const tap = async (userId: string, messageId: string, id: string) =>
    (await takeChatAction(userId, messageId, id, { client, now: later() })).message;

  beforeAll(async () => {
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

  it("finds the demo bank's wages, investments and state, and asks for the rest", async () => {
    const userId = await demoPerson("tax-found");
    const view = await loadTaxProfile(userId, { client, now: LINKED });
    expect(view.incomeKinds.status).toBe("found");
    expect(view.incomeKinds.found.map((f) => [f.kind, f.from[0]])).toEqual([
      ["w2", "ACME CORP PAYROLL"],
      ["investment", "Demo Brokerage"],
    ]);
    expect(view.state).toEqual({
      status: "found",
      value: "CA",
      from: "a California DMV payment",
    });
    expect(view.filingStatus.status).toBe("missing");
    expect(view.dependants.status).toBe("missing");

    // "Ask me first" uses only answers; "safe" uses what Jane found, marked unconfirmed.
    expect((await loadWorkingProfile(userId, { client, now: LINKED })).profile).toMatchObject({
      incomeKinds: [],
      state: null,
    });
    await setAutopilot(userId, "safe", { client, now: LINKED });
    expect((await loadWorkingProfile(userId, { client, now: LINKED })).profile).toMatchObject({
      incomeKinds: ["w2", "investment"],
      state: "CA",
      unconfirmed: ["incomeKinds", "state"],
    });
  }, 60_000);

  it("asks one question at a time in the chat until the profile is done", async () => {
    const userId = await demoPerson("tax-flow");
    await talkUntil(userId, "taxes:profile");
    let message = await profileMessage(userId);
    expect(message.body).toContain("Let's get your taxes ready.");
    expect(message.body).toContain("wages from ACME CORP PAYROLL (W-2)");

    let after = await tap(userId, message.id, "tax.found_yes");
    expect(after).toMatchObject({ status: "open", body: "How will you file for 2026?" });
    expect(after.refs.note).toBe("Got it. That's your income.");

    after = await tap(userId, message.id, "tax.filing_joint");
    expect(after.body).toContain("How many children under 17");
    expect(after.refs.note).toBe("Got it: Married filing jointly.");

    after = await tap(userId, message.id, "tax.kids_2");
    expect(after.body).toContain("You live in California");

    after = await tap(userId, message.id, "tax.found_yes");
    expect(after.status).toBe("answered");
    expect(after.answeredWith).toBe("That's right");
    expect(after.refs.note).toContain("That's your tax profile done: married filing jointly");
    message = await profileMessage(userId);
    expect(parseActions(message.actions).map((a) => a.id)).toEqual(["open"]);

    const view = await loadTaxProfile(userId, { client, now: LINKED });
    expect(view.complete).toBe(true);
    expect(await client.taxProfile.findUniqueOrThrow({ where: { userId } })).toMatchObject({
      filingStatus: "married_joint",
      childrenUnder17: 2,
      otherDependants: 0,
      state: "CA",
      incomeKinds: ["w2", "investment"],
    });
    // Which fields changed, never the answers.
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "tax_profile_changed",
      { type: "user", id: userId },
      { fields: "filingStatus", via: "chat" },
    );
    // Done: Jane doesn't ask again.
    await runJaneAgent(userId, {
      client,
      now: new Date(LINKED.getTime() + 8 * 24 * 60 * MINUTE),
      trigger: "open",
    });
    expect(await client.janeMessage.count({ where: { userId, dedupeKey: "taxes:profile" } })).toBe(
      1,
    );
  }, 60_000);

  it("refuses another person's tap, and a button the message doesn't offer", async () => {
    const userId = await demoPerson("tax-owner");
    const otherId = await person("tax-other");
    await talkUntil(userId, "taxes:profile");
    const message = await profileMessage(userId);
    await expect(
      takeChatAction(otherId, message.id, "tax.found_yes", { client }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      takeChatAction(userId, message.id, "tax.kids_2", { client }),
    ).rejects.toMatchObject({
      code: "not_offered",
    });
    expect(await client.taxProfile.count({ where: { userId: { in: [userId, otherId] } } })).toBe(0);
  }, 60_000);

  it("typing an answer offers a button, and only the tap saves it", async () => {
    const userId = await demoPerson("tax-typed");
    const { reply } = await sendToJane(userId, "I live in Texas", { client, now: later() });
    expect(reply.body).toBe("Want me to put Texas on your tax profile as the state you file in?");
    expect(await client.taxProfile.count({ where: { userId } })).toBe(0);
    const after = await tap(userId, reply.id, "tax.state_set");
    expect(after.refs.note).toBe("Got it.");
    expect((await loadTaxProfile(userId, { client, now: LINKED })).state).toMatchObject({
      status: "yours",
      value: "TX",
    });

    const profile = await sendToJane(userId, "what's my tax profile", { client, now: later() });
    expect(profile.reply.body).toContain("- State: Texas\n");
    expect(profile.reply.body).toContain("- Income: wages from a job; interest, dividends");
    expect(parseRefs(profile.reply.refs).taxField).toBe("incomeKinds");
  }, 60_000);

  it("asks before adding a new kind of income, and adds it on a tap", async () => {
    const userId = await demoPerson("tax-new-income");
    await saveTaxAnswers(userId, [{ field: "incomeKinds", value: ["w2"] }], {
      client,
      via: "page",
    });
    const account = await client.account.findFirstOrThrow({
      where: { userId, subtype: "checking" },
    });
    await client.transaction.create({
      data: {
        userId,
        accountId: account.id,
        source: "plaid",
        date: new Date("2026-10-10"),
        amountCents: -42_000,
        description: "UPWORK ESCROW INC",
        merchantName: "Upwork",
        pfcPrimary: "INCOME",
        pfcDetailed: "INCOME_CONTRACTOR",
      },
    });
    await talkUntil(userId, "taxes:income:self_employed");
    const message = await client.janeMessage.findFirstOrThrow({
      where: { userId, dedupeKey: "taxes:income:self_employed" },
    });
    expect(message.body).toContain("freelance or gig pay from Upwork");
    await tap(userId, message.id, "tax.income_add");
    expect((await loadTaxProfile(userId, { client, now: LINKED })).incomeKinds).toMatchObject({
      status: "yours",
      value: ["w2", "self_employed"],
    });
    await expect(
      addIncomeKind(userId, "self_employed", { client, via: "chat" }),
    ).rejects.toBeInstanceOf(TaxProfileError);
  }, 60_000);

  it("checks every answer and keeps each person's profile their own", async () => {
    const userId = await person("tax-checks");
    const otherId = await person("tax-checks-other");
    const save = (answers: Parameters<typeof saveTaxAnswers>[1]) =>
      saveTaxAnswers(userId, answers, { client, via: "page" });
    await expect(save([{ field: "state", value: "ZZ" }])).rejects.toThrow("Pick a state");
    await expect(save([{ field: "filingStatus", value: "widowed" as "single" }])).rejects.toThrow(
      "Pick a filing status",
    );
    await expect(
      save([{ field: "dependants", childrenUnder17: -1, otherDependants: 0 }]),
    ).rejects.toThrow("whole number");
    await expect(save([{ field: "incomeKinds", value: ["lottery" as "w2"] }])).rejects.toThrow(
      "Pick from the list",
    );
    await expect(confirmFound(userId, "state", { client, via: "page" })).rejects.toThrow(
      "There's no state to confirm",
    );

    await save([
      { field: "filingStatus", value: "single" },
      { field: "incomeKinds", value: ["investment", "w2", "w2"] },
    ]);
    await saveTaxAnswers(otherId, [{ field: "state", value: "NY" }], { client, via: "page" });
    const mine = await client.taxProfile.findUniqueOrThrow({ where: { userId } });
    expect(mine).toMatchObject({
      filingStatus: "single",
      incomeKinds: ["w2", "investment"],
      state: null,
    });
    expect(mine.answered.sort()).toEqual(["filingStatus", "incomeKinds"]);
  });

  it("gives Claude the profile through the tax_profile tool, with figures recorded", async () => {
    const userId = await demoPerson("tax-tool");
    const result = await runChatTool(userId, "tax_profile", {}, { client, now: LINKED });
    const data = JSON.parse(result.content);
    expect(data.filingStatus).toBeNull();
    expect(data.state).toEqual({ name: "California", status: "found" });
    expect(data.income.seenInAccounts[0]).toMatchObject({ kind: "Wages from a job", form: "W-2" });
    expect(data.janeDoesByHerself[0]).toContain("I work out what I can");
    expect(result.cents.length).toBeGreaterThan(0);
  }, 60_000);
});
