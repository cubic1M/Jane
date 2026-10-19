import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { GAP_ADVICE } from "@/config/insurance";
import { EMPTY_POLICY_INPUT, addPolicy } from "@/lib/insurance/policies";
import { loadInsurance } from "@/lib/insurance/profile";
import { ChatActionError, takeChatAction } from "../actions";
import { answerByRules } from "../answer";
import { CHAT_TOOLS, runChatTool } from "../claude-tools";
import { parseIntent } from "../intents";
import { runJaneAgent } from "../run";
import { parseActions, parseRefs } from "../types";

// Insurance in Jane's chat against a real, migrated Postgres (spec step 102): a gap
// brought up by itself, "I don't need it" through the profile's own code, answers from the
// records and the Claude tool with its figures recorded.

const url = process.env.TEST_DATABASE_URL;
// 9am in Los Angeles: after quiet hours.
const NOW = new Date("2026-10-19T16:00:00Z");
const ASOF = "2026-10-19";

describe.runIf(url)("insurance in Jane's chat, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function homeowner() {
    const user = await client.user.create({
      data: { email: `ins-chat-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await client.account.createMany({
      data: [
        {
          userId: user.id,
          source: "csv",
          name: "Checking",
          type: "depository",
          subtype: "checking",
        },
        { userId: user.id, source: "plaid", name: "Home loan", type: "loan", subtype: "mortgage" },
      ],
    });
    return user.id;
  }
  const gapMessage = async (userId: string) =>
    (await client.janeMessage.findMany({ where: { userId } })).find(
      (m) => parseRefs(m.refs).insuranceGap === "home",
    );

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("brings up a gap by itself, and I don't need it closes it for good", async () => {
    const me = await homeowner();
    await runJaneAgent(me, { client, now: NOW, trigger: "open" });
    const message = await gapMessage(me);
    expect(message?.body).toMatch(/^No home insurance on file\./);
    expect(parseActions(message?.actions).map((a) => a.id)).toEqual([
      "open",
      "insurance.gap_no",
      "snooze",
    ]);

    // Someone else can't answer it.
    const other = await homeowner();
    await expect(
      takeChatAction(other, message!.id, "insurance.gap_no", { client, now: NOW }),
    ).rejects.toBeInstanceOf(ChatActionError);

    const { message: answered } = await takeChatAction(me, message!.id, "insurance.gap_no", {
      client,
      now: NOW,
    });
    expect(answered).toMatchObject({ status: "answered", answeredWith: "I don't need it" });
    expect(answered.refs.note).toBe("OK. I won't bring it up again.");
    expect((await loadInsurance(me, { client, now: NOW })).gaps).toEqual([]);
    await expect(
      takeChatAction(me, message!.id, "insurance.gap_no", { client, now: NOW }),
    ).rejects.toMatchObject({ code: "not_open" });
  });

  it("answers insurance questions from the records", async () => {
    const me = await homeowner();
    await addPolicy(
      me,
      {
        ...EMPTY_POLICY_INPUT,
        kind: "home",
        carrier: "Allstate",
        premium: "1500",
        premiumFrequency: "yearly",
        renewalDate: "2027-01-15",
        coverage: { dwelling: "400000" },
      },
      { client },
    );
    const answer = (text: string) =>
      answerByRules(me, parseIntent(text, ASOF), { client, now: NOW });
    expect((await answer("when does my home insurance renew"))?.body).toBe(
      "Your Allstate home insurance renews on Jan 15, 2027, in 88 days.",
    );
    expect((await answer("what does my home insurance cover"))?.body).toBe(
      "Your Allstate home insurance covers what's below, from its record.\n- The home itself: $400,000.00",
    );
    expect((await answer("what insurance am I missing"))?.body).toMatch(/^Nothing looks missing/);
  });

  it("gives Claude the profile, with every figure recorded for the guardrails", async () => {
    expect(CHAT_TOOLS.map((t) => t.name)).toContain("insurance_policies");
    const me = await homeowner();
    await addPolicy(
      me,
      {
        ...EMPTY_POLICY_INPUT,
        kind: "auto",
        carrier: "GEICO",
        premium: "142",
        premiumFrequency: "monthly",
        deductible: "1000",
        coverage: { propertyDamage: "50000" },
      },
      { client },
    );
    const output = await runChatTool(me, "insurance_policies", {}, { client, now: NOW });
    const data = JSON.parse(output.content);
    expect(data.policies[0]).toMatchObject({
      what: "GEICO car insurance",
      price: "$142.00",
      paid: "a month",
      aYear: "$1,704.00",
      deductible: "$1,000.00",
      limits: { "Property damage liability": "$50,000.00" },
    });
    expect(data.household.home).toEqual({ value: "Own", from: "accounts" });
    expect(data.gaps.map((g: { what: string }) => g.what)).toEqual(["No home insurance on file"]);
    expect(output.cents).toEqual(expect.arrayContaining([14_200, 170_400, 100_000, 5_000_000]));
    // A real account never gets advice (spec step 98).
    expect(data.gaps[0].demoAdviceWhatToAdd).toBeUndefined();
  });

  it("says what to add to a demo-bank person, as demo advice", async () => {
    const me = await homeowner();
    await client.account.deleteMany({ where: { userId: me, source: "csv" } });
    await client.plaidItem.create({
      data: {
        userId: me,
        plaidItemId: `demo-${crypto.randomUUID()}`,
        accessTokenEncrypted: "v1:unused",
      },
    });
    const data = JSON.parse(
      (await runChatTool(me, "insurance_policies", {}, { client, now: NOW })).content,
    );
    expect(data.gaps[0].demoAdviceWhatToAdd).toBe(GAP_ADVICE.home.text);
    await runJaneAgent(me, { client, now: NOW, trigger: "open" });
    const message = await gapMessage(me);
    expect(message?.body).toContain(GAP_ADVICE.home.text);
    expect(parseRefs(message?.refs).advice).toBe(true);
  });
});
