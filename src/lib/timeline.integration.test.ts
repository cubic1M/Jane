import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { SECTORS } from "@/config/autopilot-sectors";
import { RULE_ACT_PREFIX } from "@/config/rules";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { recordAct } from "@/lib/sector-autopilot";
import { loadTimeline } from "./timeline";

// Spec step 187 against a real Postgres: every action Jane takes on its own is written when
// it takes it (recordAct), and every one appears on the timeline with its reason; nothing
// of another person's does.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("everything Jane did, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const person = async (prefix: string) => {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  };
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("lists every autopilot action with its reason and money, newest first, only mine", async () => {
    const userId = await person("timeline-mine");
    const other = await person("timeline-other");
    for (const [i, sector] of SECTORS.entries()) {
      await recordAct(userId, sector, 1_000 * (i + 1), `Did ${sector} thing`, {
        client,
        now: new Date(Date.UTC(2026, 9, 10 + i)),
      });
    }
    await recordAct(other, "bills", 500, "Someone else's", { client });

    const timeline = await loadTimeline(userId, { client });
    expect(timeline).toHaveLength(SECTORS.length);
    expect(timeline.map((e) => e.what)).toEqual(
      [...SECTORS].reverse().map((s) => `Did ${s} thing`),
    );
    expect(timeline.every((e) => e.by === "jane" && e.why.length > 0)).toBe(true);
    expect(timeline[0]).toMatchObject({ cents: 6_000, sector: "goals" });
    // Nothing missing against the record Jane keeps of its own acts.
    expect(await client.autopilotAct.count({ where: { userId } })).toBe(timeline.length);
  });

  it("lists a standing rule's yes once, as the rule's decision", async () => {
    // Gap audit: the rule's decision and the area's act for it were both listed.
    const userId = await person("timeline-rule");
    const finding = await client.finding.create({
      data: {
        userId,
        type: "bank_fees",
        key: `fees-${crypto.randomUUID()}`,
        title: "$270.00 in fees on Demo Checking",
        annualSavingsCents: 27_000,
        confidence: "high",
        evidence: {},
      },
    });
    await client.decision.create({
      data: {
        userId,
        findingId: finding.id,
        choice: "yes",
        source: "rule",
        ruleKey: "recover_bank_fees",
        cardSnapshot: { title: finding.title },
      },
    });
    await recordAct(userId, "bills", 0, `${RULE_ACT_PREFIX}${finding.title}`, { client });
    const timeline = await loadTimeline(userId, { client });
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      what: finding.title,
      why: "A standing rule you set said yes to this.",
    });
    // The chat gets the same list (gap audit: Claude had no tool for it).
    const tool = JSON.parse(
      (await runChatTool(userId, "what_jane_did", {}, { client, now: new Date() })).content,
    );
    expect(tool.entries).toEqual([
      expect.objectContaining({
        what: finding.title,
        by: "Jane, on its own",
        why: "A standing rule you set said yes to this.",
      }),
    ]);
  });

  // Debugger 11-02: on the path founders record, /jane said "Everything Jane did: nothing yet"
  // right after a Yes, with an action underway and money saved.
  it("includes what Jane did after a person's yes", async () => {
    const userId = await person("timeline-yes");
    const action = async (
      title: string,
      status: "waiting_on_user" | "done" | "failed",
      extra: { refundCents?: number } = {},
      undoneAt: Date | null = null,
    ) => {
      const finding = await client.finding.create({
        data: {
          userId,
          type: "subscription_review",
          key: `merchant:${title}`,
          title,
          explanation: "x",
          confidence: "high",
          evidence: {},
        },
      });
      const decision = await client.decision.create({
        data: {
          userId,
          findingId: finding.id,
          choice: "yes",
          cardSnapshot: { title, annualSavingsCents: 35_988 },
          undoneAt,
        },
      });
      return client.action.create({
        data: { userId, decisionId: decision.id, type: "cancel_subscription", status, ...extra },
      });
    };
    const adobe = await action("Review your Adobe subscription", "waiting_on_user");
    await client.agentMessage.create({
      data: {
        actionId: adobe.id,
        userId,
        direction: "note",
        toAddress: "",
        fromAddress: "Jane",
        subject: "",
        body: "Asked you to cancel on Adobe's own page.",
      },
    });
    await action("Review your Hulu subscription", "done");
    await action("B&H Photo: the refund", "done", { refundCents: 12_900 });
    await action("Could not finish", "failed");
    await action("Undone one", "waiting_on_user", {}, new Date());

    const timeline = await loadTimeline(userId, { client });
    expect(timeline.map((e) => e.what).sort()).toEqual([
      "B&H Photo: the refund",
      "Could not finish",
      "Review your Adobe subscription",
      "Review your Hulu subscription",
    ]);
    const of = (what: string) => timeline.find((e) => e.what === what)!;
    expect(of("Review your Adobe subscription")).toMatchObject({
      by: "you",
      why: "Asked you to cancel on Adobe's own page.",
      cents: null,
    });
    expect(of("Review your Hulu subscription").why).toBe(
      "You said yes. Done: about $359.88 a year.",
    );
    expect(of("B&H Photo: the refund")).toMatchObject({
      why: "You said yes. Done: got back $129.00.",
      cents: 12_900,
    });

    expect(of("Could not finish").why).toBe("You said yes. Couldn't complete.");
    expect(of("Review your Adobe subscription").sectorLabel).toBe("Subscriptions and bills");
  });

  it("includes what the person tapped, with undo while it's pending", async () => {
    const userId = await person("timeline-transfer");
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    await client.moneyTransfer.create({
      data: {
        userId,
        fromAccountId: account.id,
        toName: "Emergency fund",
        amountCents: 3_400,
        purpose: "goal",
        sector: "goals",
        runOn: new Date("2026-10-25T00:00:00Z"),
        partner: "stand-in",
        by: "person",
      },
    });
    const [entry] = await loadTimeline(userId, { client });
    expect(entry).toMatchObject({
      by: "you",
      what: "Moved $34.00 to Emergency fund",
      undoHref: "/transfers",
    });
  });
});
