import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

// The dock's taps (src/app/chat/suggestion-cards.tsx) go through tapButton with the payload the
// shared builder makes (src/lib/jane-agent/tap.ts). Hotfix: #2305 made "Done, next step" and
// "Raise it" need what the card showed, and the dock sent none, so both did nothing, silently.

const { current } = vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  return { current: { userId: "" } };
});
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: current.userId, email: "dock@example.com" })),
}));
vi.mock("@/lib/agent/run", () => ({ runAgentNow: vi.fn(), runQueuedFor: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadStudentLoans } from "@/lib/student-loans";
import { listPolicies } from "@/lib/insurance/policies";
import { refreshSavings } from "@/lib/insurance/savings";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { stepMessage } from "@/lib/jane-agent/student-replies";
import { tapPayload } from "@/lib/jane-agent/tap";
import { parseActions, parseRefs, type ChatMessage } from "@/lib/jane-agent/types";
import { toView, type MessageView } from "@/lib/jane-agent/view";
import { tapButton } from "./actions";

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("a tap from the dock, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person() {
    const user = await client.user.create({
      data: { email: `dock-tap-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    current.userId = user.id;
    return user.id;
  }
  const viewOf = (row: {
    id: string;
    kind: string;
    body: string;
    refs: unknown;
    actions: unknown;
    status: string;
    createdAt: Date;
  }): MessageView =>
    toView(
      {
        ...row,
        refs: parseRefs(row.refs),
        actions: parseActions(row.actions),
        answeredWith: null,
        answeredAt: null,
      } as ChatMessage,
      new Date(),
      null,
    );

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("Done, next step with the payload the dock builds moves the step on", async () => {
    const userId = await person();
    const shown = stepMessage(0);
    const row = await client.janeMessage.create({
      data: {
        userId,
        kind: "decision",
        body: shown.body,
        refs: shown.refs,
        actions: shown.actions,
        dedupeKey: `student:dock:${crypto.randomUUID()}`,
      },
    });
    const view = viewOf(row);
    expect(view.shown).toBe("student:0");
    const data = tapPayload(view, "student.next");
    expect(data.get("shown")).toBe("student:0");
    const result = await tapButton({ message: view, error: null }, data);
    expect(result.error).toBeNull();
    expect(result.message.body).toContain("step 2 of");
    expect((await loadStudentLoans(userId, { client })).profile.stepsDone).toBe(1);
  });

  it("a stale step is refused with its reason, and nothing moves", async () => {
    const userId = await person();
    await client.studentLoanProfile.create({ data: { userId, stepsDone: 2 } });
    const shown = stepMessage(0);
    const row = await client.janeMessage.create({
      data: {
        userId,
        kind: "decision",
        body: shown.body,
        refs: shown.refs,
        actions: shown.actions,
        dedupeKey: `student:dock:${crypto.randomUUID()}`,
      },
    });
    const view = viewOf(row);
    const stale = tapPayload({ id: view.id, shown: "student:1" }, "student.next");
    const result = await tapButton({ message: view, error: null }, stale);
    expect(result.error).toBe("That step has already moved on. Open the latest one.");
    expect((await loadStudentLoans(userId, { client })).profile.stepsDone).toBe(2);
  });

  it("Raise it with the payload the dock builds applies; a stale token is refused", async () => {
    const userId = await person();
    await client.account.create({
      data: {
        userId,
        source: "plaid",
        name: "Savings",
        type: "depository",
        subtype: "savings",
        currentBalanceCents: 2_800_000,
      },
    });
    await client.plaidItem.create({
      data: { userId, plaidItemId: `demo-${crypto.randomUUID()}`, accessTokenEncrypted: "v1:x" },
    });
    await client.insurancePolicy.create({
      data: {
        userId,
        kind: "auto",
        carrier: "GEICO",
        source: "typed",
        status: "active",
        premiumCents: 14_200,
        premiumFrequency: "monthly",
        deductibleCents: 100_000,
      },
    });
    const now = new Date();
    await refreshSavings(userId, { client, now });
    await runJaneAgent(userId, { client, now, trigger: "open" });
    const row = (await client.janeMessage.findMany({ where: { userId } })).find(
      (m) => parseRefs(m.refs).savingId,
    )!;
    const view = viewOf(row);
    expect(view.shown).toMatch(/^saving:/);
    const refused = await tapButton(
      { message: view, error: null },
      tapPayload({ id: view.id, shown: "saving:x:old" }, "saving.apply"),
    );
    expect(refused.error).toMatch(/out of date/);
    expect((await listPolicies(userId, { client }))[0].deductibleCents).toBe(100_000);
    const result = await tapButton(
      { message: view, error: null },
      tapPayload(view, "saving.apply"),
    );
    expect(result.error).toBeNull();
    expect((await listPolicies(userId, { client }))[0].deductibleCents).not.toBe(100_000);
  });
});
