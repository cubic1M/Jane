import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { takeChatAction } from "@/lib/jane-agent/actions";
import { answerByRules } from "@/lib/jane-agent/answer";
import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { postMessages } from "@/lib/jane-agent/messages";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { lifeSource } from "@/lib/jane-agent/sources/life";
import { lifeGuessesFor } from "./life-guesses";

// Spec step 100 against a real, migrated Postgres: someone paying a mover and a new
// landlord is asked once if they're moving; Yes starts the checklist and Jane does what it
// can itself (a Home budget, an insurance review and reminders on Deadlines); Not me and
// Don't ask again stop the question; one signal never asks.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-15T15:00:00Z");

describe.runIf(url)("life events spotted, against a real database", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];

  // Four months of rent to one landlord and some Home spending; then, if moving, a U-Haul
  // and a first payment to a new landlord.
  async function person(prefix: string, { moving = true, mover = true } = {}) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    const row = (
      date: string,
      description: string,
      amountCents: number,
      pfc: [string, string],
    ) => ({
      userId: user.id,
      accountId: account.id,
      source: "csv" as const,
      date: new Date(`${date}T00:00:00Z`),
      description,
      amountCents,
      pfcPrimary: pfc[0],
      pfcDetailed: pfc[1],
    });
    const RENT: [string, string] = ["RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT"];
    const HOME: [string, string] = ["HOME_IMPROVEMENT", "HOME_IMPROVEMENT_HARDWARE"];
    await client.transaction.createMany({
      data: [
        ...["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"].map((d) =>
          row(d, "OAK APARTMENTS RENT", 180_000, RENT),
        ),
        ...["2026-07-12", "2026-08-12", "2026-09-12"].map((d) =>
          row(d, "HOME DEPOT", 12_000, HOME),
        ),
        ...(mover
          ? [
              row("2026-09-28", "U-HAUL MOVING", 24_000, [
                "GENERAL_SERVICES",
                "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
              ]),
            ]
          : []),
        ...(moving ? [row("2026-10-01", "MAPLE COURT LEASING RENT", 195_000, RENT)] : []),
      ],
    });
    return user.id;
  }

  async function ask(userId: string) {
    const snapshot = await loadSnapshot(userId, { client, now: NOW });
    await postMessages(userId, gather(snapshot!, NOW, { trigger: "open", sources: [lifeSource] }), {
      client,
      now: NOW,
    });
    return client.janeMessage.findMany({
      where: { userId, dedupeKey: { startsWith: "life:" } },
      orderBy: { createdAt: "asc" },
    });
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("asks once, and Yes runs the moving checklist by itself", async () => {
    const userId = await person("life-yes");
    const [question] = await ask(userId);
    expect(question.body).toMatch(
      /^I noticed a U-Haul Moving charge on Sep 28 and a first rent payment to .+\. Are you moving\? If so, I'll set a Home budget if you don't have one, flag your insurance to review and put reminders on your deadlines\./,
    );
    // Asked once: the same guess isn't posted again.
    expect(await ask(userId)).toHaveLength(1);

    const { message } = await takeChatAction(userId, question.id, "life.yes", { client, now: NOW });
    expect(message.answeredWith).toBe("Yes");
    expect(message.refs.note).toMatch(
      /^Done\. I started your moving checklist\. I set a budget for Home at \$120\.00 a month\. On your deadlines: "Review your insurance for the new address" by Oct 29, /,
    );
    const event = await client.lifeEvent.findFirstOrThrow({ where: { userId, kind: "moving" } });
    expect(event.checkedItems).toEqual(["budget"]);
    expect(await client.budget.findFirst({ where: { userId, category: "Home" } })).toMatchObject({
      amountCents: 12_000,
    });
    const deadlines = await client.deadline.findMany({
      where: { userId },
      orderBy: { dueOn: "asc" },
    });
    expect(deadlines.map((d) => [d.title, d.dueOn.toISOString().slice(0, 10)])).toEqual([
      ["Forward your mail with the post office", "2026-10-22"],
      ["Review your insurance for the new address", "2026-10-29"],
      ["Check your old security deposit came back", "2026-11-29"],
    ]);
    // With the checklist going, it isn't asked again.
    expect(await lifeGuessesFor(userId, { client, now: NOW })).toEqual([]);
  });

  it("stops at Not me, and Don't ask again stops every kind", async () => {
    const notMe = await person("life-not-me");
    const [q1] = await ask(notMe);
    await takeChatAction(notMe, q1.id, "life.no", { client, now: NOW });
    expect(await lifeGuessesFor(notMe, { client, now: NOW })).toEqual([]);
    expect(await client.lifeEvent.count({ where: { userId: notMe } })).toBe(0);

    const never = await person("life-never");
    const [q2] = await ask(never);
    const { message } = await takeChatAction(never, q2.id, "life.never", { client, now: NOW });
    expect(message.refs.note).toMatch(/^OK\. I won't ask about life changes again\./);
    expect(await client.lifeEventAnswer.findMany({ where: { userId: never } })).toMatchObject([
      { kind: "all", answer: "never" },
    ]);
    expect(await lifeGuessesFor(never, { client, now: NOW })).toEqual([]);
  });

  it("never asks on one signal", async () => {
    const userId = await person("life-one", { mover: false });
    expect(await lifeGuessesFor(userId, { client, now: NOW })).toEqual([]);
    expect(await ask(userId)).toEqual([]);
  });

  it("starts it from 'I'm moving' in the chat, and tells Claude", async () => {
    const userId = await person("life-typed", { moving: false, mover: false });
    const reply = await answerByRules(
      userId,
      { kind: "life_event", event: "moving" },
      { client, now: NOW },
    );
    expect(reply?.body).toMatch(/^Exciting! Want me to start your moving checklist\?/);
    expect(reply?.actions.map((a) => a.id)).toEqual(["life.yes", "open"]);
    expect(reply?.refs).toEqual({ lifeKind: "moving" });

    const tool = await runChatTool(userId, "life_events", {}, { client, now: NOW });
    expect(JSON.parse(tool.content)).toEqual({ spotted: [], checklists: [] });

    const asker = await person("life-tool");
    const out = JSON.parse(
      (await runChatTool(asker, "life_events", {}, { client, now: NOW })).content,
    );
    expect(out.spotted[0]).toMatch(
      /^Moving: a U-Haul Moving charge on Sep 28; a first rent payment/,
    );
  });

  it("only sees the person's own data", async () => {
    const mover = await person("life-own");
    const other = await person("life-other", { moving: false, mover: false });
    const [question] = await ask(mover);
    await expect(
      takeChatAction(other, question.id, "life.yes", { client, now: NOW }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await client.lifeEvent.count({ where: { userId: { in: [mover, other] } } })).toBe(0);
  });
});
