import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { ChatActionError, takeChatAction } from "./actions";
import { createCheckPerson, deleteCheckPerson } from "./checks/person";
import { sendToJane } from "./typing";

// Spec step 88 against a real, migrated Postgres and the demo bank: follow-ups go with what
// was just said ("cancel it" after "how much is Netflix"), never with something from
// another day or long ago, and a clarifying question's button answers in the chat.

const url = process.env.TEST_DATABASE_URL;
// 8am in Los Angeles (the default timezone).
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60_000;
const at = (minutes: number) => new Date(LINKED.getTime() + minutes * MINUTE);
const ids = (m: { actions: { id: string }[] }) => m.actions.map((a) => a.id);

describe.runIf(url)("Jane understands follow-ups against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let otherId: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = await createCheckPerson({ client, now: LINKED });
    otherId = await createCheckPerson({ client, now: LINKED });
  }, 120_000);
  afterAll(async () => {
    await deleteCheckPerson(userId, { client });
    await deleteCheckPerson(otherId, { client });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const send = (text: string, now: Date, who = userId) => sendToJane(who, text, { client, now });

  it("points 'it' at what was just talked about", async () => {
    const cost = await send("how much is Netflix", at(1));
    expect(cost.reply.body).toMatch(/^Netflix is \$17\.99 a month/);
    const findingId = cost.reply.refs.findingId;
    expect(findingId).toBeTruthy();

    const it = await send("cancel it", at(2));
    expect(it.source).toBe("rules");
    expect(it.reply.refs.findingId).toBe(findingId);
    expect(ids(it.reply)).toContain("finding.yes");
  });

  it("asks the same about another name, and another month", async () => {
    await send("cancel Hulu", at(10));
    const peacock = await send("and Peacock?", at(11));
    expect(peacock.reply.body).toMatch(/Peacock/);
    expect(ids(peacock.reply)).toContain("finding.yes");

    const september = await send("how much did I spend on food last month", at(12));
    expect(september.reply.body).toMatch(/in September 2026\./);
    const october = await send("what about this month?", at(13));
    expect(october.reply.body).toMatch(
      /^You spent \$[\d,.]+ on Food and drink in October 2026 so far\./,
    );
  });

  it("never points 'it' at something from long ago or another day", async () => {
    await send("how much is Netflix", at(30));
    const later = await send("cancel it", at(30 + 31));
    expect(later.reply.body).toBe("Which one do you mean?");
    expect(ids(later.reply)[0]).toBe("clarify.1");

    // 11:50pm, then 12:05am: within the half hour, but another day.
    const lateNight = new Date("2026-10-19T06:50:00Z");
    await send("how much is Netflix", lateNight);
    const nextDay = await send("cancel it", new Date(lateNight.getTime() + 15 * MINUTE));
    expect(nextDay.reply.body).toBe("Which one do you mean?");
  });

  it("answers a clarifying question's button in the chat, only for its own person", async () => {
    const which = await send("the bank fees", at(200));
    expect(which.reply.body).toBe('I found 2 things about "bank fees". Which one do you mean?');
    expect(ids(which.reply)).toEqual(["clarify.1", "clarify.2"]);

    await expect(
      takeChatAction(otherId, which.reply.id, "clarify.1", { client, now: at(201) }),
    ).rejects.toBeInstanceOf(ChatActionError);
    await expect(
      takeChatAction(userId, which.reply.id, "clarify.3", { client, now: at(201) }),
    ).rejects.toMatchObject({ code: "not_offered" });

    const tapped = await takeChatAction(userId, which.reply.id, "clarify.1", {
      client,
      now: at(201),
    });
    expect(tapped.posted).toBe(true);
    expect(tapped.message).toMatchObject({ status: "answered" });
    expect(tapped.message.answeredWith).toMatch(/fees/);
    // Just under the question.
    const answer = await client.janeMessage.findFirstOrThrow({
      where: { userId, kind: "reply", createdAt: { gt: at(201), lt: at(202) } },
    });
    expect(answer.body).toMatch(/fees/);
    expect(ids({ actions: answer.actions as { id: string }[] })).toContain("finding.yes");
    // Tapping again changes nothing.
    await expect(
      takeChatAction(userId, which.reply.id, "clarify.2", { client, now: at(202) }),
    ).rejects.toMatchObject({ code: "not_open" });
    // Nothing was decided by the tap itself.
    expect(await client.decision.count({ where: { userId } })).toBe(0);
  });
});
