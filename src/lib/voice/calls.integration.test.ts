import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { findingOfType } from "@/lib/__fixtures__/findings";
import { agentStep } from "@/lib/agent/run";
import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { recordDecision } from "@/lib/decisions";
import { savedToDate } from "@/lib/membership/service";
import { answerOffer, handleCallResult, simulatedCallResult } from "./calls";
import type { CallResult } from "./provider";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("phone negotiation, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const notify = vi.fn(async () => undefined);

  // An approved bill negotiation, with the call placed.
  async function called(source: "card" | "rule" = "card", acceptSimpleOffers = false) {
    const user = await client.user.create({
      data: {
        email: `call-${crypto.randomUUID()}@example.com`,
        name: "Alex Rivera",
        acceptSimpleOffers,
      },
    });
    created.push(user.id);
    const f = findingOfType("bill_negotiation");
    const finding = await client.finding.create({
      data: {
        userId: user.id,
        type: f.type,
        key: `${f.key}-${crypto.randomUUID()}`,
        title: f.title,
        annualSavingsCents: f.annualSavingsCents,
        amountCents: f.amountCents,
        confidence: f.confidence,
        evidence: f.evidence as Prisma.InputJsonObject,
      },
      select: CARD_SELECT,
    });
    const { actionId } = await recordDecision(
      user.id,
      { findingId: finding.id, choice: "yes", cardHash: cardHash(buildCard(finding)), source },
      { client },
    );
    const step = await agentStep(user.id, actionId!, { client, notify });
    const action = await client.action.findUniqueOrThrow({ where: { id: actionId! } });
    return { userId: user.id, action, step, evidence: f.evidence as { monthlyCents: number } };
  }

  const result = (over: Partial<CallResult>): CallResult => ({
    outcome: "refused",
    transcript: "Provider: no offers.",
    newMonthlyCents: null,
    offer: null,
    ...over,
  });
  const reload = (id: string) => client.action.findUniqueOrThrow({ where: { id } });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("calls with a script that says typical price and never accepts a contract", async () => {
    const { action, step } = await called();
    expect(step).toBe("sent");
    expect(action).toMatchObject({ status: "in_progress", agentState: "waiting_reply" });
    const script = await client.agentMessage.findFirstOrThrow({ where: { actionId: action.id } });
    expect(script.toAddress).toBe("tel:+1 555 0100");
    expect(script.body).toContain("typical price");
    expect(script.body).toContain("This call may be recorded.");
    expect(script.body).toContain("Don't accept a contract");
  });

  it("closes the bill with the yearly savings when the price comes down", async () => {
    const { userId, action, evidence } = await called();
    const lower = evidence.monthlyCents - 4_500;
    await handleCallResult(
      action.replyToken!,
      result({ outcome: "lowered", newMonthlyCents: lower }),
      { client, notify },
    );
    expect(await reload(action.id)).toMatchObject({
      status: "done",
      confirmedAnnualCents: 4_500 * 12,
    });
    expect(await savedToDate(userId, { client })).toBe(4_500 * 12);
    const transcript = await client.agentMessage.findFirstOrThrow({
      where: { actionId: action.id, direction: "inbound" },
    });
    expect(transcript.summary).toContain("lowered the bill");
  });

  it("brings an offer to the person, who decides", async () => {
    const accepted = await called();
    await handleCallResult(
      accepted.action.replyToken!,
      result({ outcome: "offer", offer: "$95.00 a month with a 12-month contract" }),
      { client, notify },
    );
    const waiting = await reload(accepted.action.id);
    expect(waiting).toMatchObject({ status: "waiting_on_user", agentState: "confirming" });
    expect(waiting.userTodo).toContain("12-month contract");
    await answerOffer(accepted.userId, accepted.action.id, true, { client, notify });
    expect(await reload(accepted.action.id)).toMatchObject({
      status: "queued",
      agentState: "handed_off",
    });

    const declined = await called();
    await handleCallResult(declined.action.replyToken!, result({ outcome: "offer", offer: "x" }), {
      client,
      notify,
    });
    await answerOffer(declined.userId, declined.action.id, false, { client, notify });
    expect(await reload(declined.action.id)).toMatchObject({ status: "failed" });
  });

  it("passes refusals and account-holder-only calls on", async () => {
    const refused = await called();
    await handleCallResult(refused.action.replyToken!, result({}), { client, notify });
    expect((await reload(refused.action.id)).agentState).toBe("handed_off");

    const person = await called();
    await handleCallResult(person.action.replyToken!, result({ outcome: "needs_person" }), {
      client,
      notify,
    });
    expect(await reload(person.action.id)).toMatchObject({
      status: "waiting_on_user",
      agentState: "handed_off",
    });
  });

  it("never calls on a rule's say-so", async () => {
    const { action, step } = await called("rule");
    expect(step).toBe("handed_off");
    expect(action.handoffReason).toContain("own yes");
    expect(
      await client.agentMessage.count({ where: { actionId: action.id, direction: "outbound" } }),
    ).toBe(0);
  });

  it("runs a simulated call to an outcome", async () => {
    const { userId, action } = await called();
    await simulatedCallResult(userId, action.id, { client });
    expect((await reload(action.id)).agentState).not.toBe("waiting_reply");
    expect(
      await client.agentMessage.count({
        where: { actionId: action.id, direction: { in: ["outbound", "inbound"] } },
      }),
    ).toBe(2);
    expect(await handleCallResult("nope", result({}), { client, notify })).toBe("unknown");
  });

  it("accepts an offer inside the person's limit, and brings the rest to them", async () => {
    const simple = { monthlyCents: 9_900, contractMonths: 0, feeCents: 0 };
    const within = await called("card", true);
    const script = await client.agentMessage.findFirstOrThrow({
      where: { actionId: within.action.id },
    });
    expect(script.body).toContain("no contract and no fee");
    await handleCallResult(
      within.action.replyToken!,
      result({ outcome: "offer", offer: "basic plan", offerTerms: simple }),
      { client, notify },
    );
    expect(await reload(within.action.id)).toMatchObject({
      status: "done",
      confirmedAnnualCents: (within.evidence.monthlyCents - 9_900) * 12,
    });

    // A contract always comes to the person, limit or not.
    const contract = await called("card", true);
    await handleCallResult(
      contract.action.replyToken!,
      result({
        outcome: "offer",
        offer: "12 months",
        offerTerms: { ...simple, contractMonths: 12 },
      }),
      { client, notify },
    );
    expect((await reload(contract.action.id)).status).toBe("waiting_on_user");

    // Without the limit, even a no-strings offer comes to them.
    const off = await called("card", false);
    await handleCallResult(
      off.action.replyToken!,
      result({ outcome: "offer", offer: "basic plan", offerTerms: simple }),
      { client, notify },
    );
    expect((await reload(off.action.id)).status).toBe("waiting_on_user");
  });
});
