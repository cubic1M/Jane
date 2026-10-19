import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { exportUserData } from "@/lib/data-export";
import { ChatActionError, takeChatAction } from "./actions";
import { createCheckPerson, deleteCheckPerson } from "./checks/person";
import { deletePreference, listPreferences } from "./preferences";
import { runJaneAgent } from "./run";
import { loadSnapshot } from "./snapshot";
import { sendToJane } from "./typing";
import { parseActions, parseRefs } from "./types";

// Spec step 91 against a real, migrated Postgres and the demo bank: nothing typed is saved
// without "Remember this"; what's saved is used (the payday); "Don't suggest again" is a No
// that holds, even when the same finding turns up again; "I need …" keeps a cut from being
// suggested; and only the person's own can be saved, read or forgotten.

const url = process.env.TEST_DATABASE_URL;
// 8am in Los Angeles.
const LINKED = new Date("2026-10-18T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (minutes: number) => new Date(LINKED.getTime() + minutes * 60_000);

describe.runIf(url)("Jane remembers, against a real database", () => {
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

  it("saves what was said only on the tap, and then uses it", async () => {
    const { reply } = await sendToJane(userId, "payday is the 1st and 15th", {
      client,
      now: at(1),
    });
    expect(reply.body).toMatch(/^I can remember that: paid on the 1st and the 15th\./);
    expect(await listPreferences(userId, { client })).toEqual([]);

    await expect(
      takeChatAction(otherId, reply.id, "pref.save", { client, now: at(2) }),
    ).rejects.toBeInstanceOf(ChatActionError);
    expect(await listPreferences(otherId, { client })).toEqual([]);

    await takeChatAction(userId, reply.id, "pref.save", { client, now: at(2) });
    expect(await listPreferences(userId, { client })).toEqual([
      expect.objectContaining({ kind: "fact", key: "payday", value: { days: [1, 15] } }),
    ]);
    const payday = await sendToJane(userId, "when do I get paid", { client, now: at(3) });
    expect(payday.reply.body).toBe("Your next payday is Nov 1 (in 14 days), as you told me.");
  });

  it("never brings back a suggestion the person said not to make again", async () => {
    await runJaneAgent(userId, { client, now: LINKED, trigger: "open" });
    const message = (
      await client.janeMessage.findMany({ where: { userId, kind: "decision" } })
    ).find((m) => parseActions(m.actions).some((a) => a.id === "suggest.never"))!;
    const findingId = parseRefs(message.refs).findingId!;

    const { message: after } = await takeChatAction(userId, message.id, "suggest.never", {
      client,
      now: at(10),
    });
    expect(after.refs.note).toMatch(/^OK\. I won't suggest this again\./);
    // A No, as on its card.
    expect(
      await client.decision.findFirst({ where: { userId, findingId }, select: { choice: true } }),
    ).toEqual({ choice: "no" });

    // Even found again as new, it's left out of everything Jane looks at.
    await client.finding.update({ where: { id: findingId }, data: { status: "new" } });
    await client.decision.deleteMany({ where: { userId, findingId } });
    const snapshot = await loadSnapshot(userId, { client, now: new Date(LINKED.getTime() + DAY) });
    expect(snapshot?.findings.map((f) => f.findingId)).not.toContain(findingId);
    await runJaneAgent(userId, { client, now: new Date(LINKED.getTime() + DAY), trigger: "open" });
    const posted = await client.janeMessage.findMany({ where: { userId, kind: "decision" } });
    expect(posted.filter((m) => parseRefs(m.refs).findingId === findingId)).toHaveLength(1);
  });

  it("doesn't suggest cutting what the person needs", async () => {
    const netflix = async () =>
      (await loadSnapshot(userId, { client, now: at(30) }))?.findings.filter(
        (f) => f.type === "subscription_review" && /Netflix/.test(f.title),
      ) ?? [];
    expect(await netflix()).toHaveLength(1);
    const { reply } = await sendToJane(userId, "don't cancel netflix", { client, now: at(31) });
    await takeChatAction(userId, reply.id, "pref.save", { client, now: at(32) });
    expect(await netflix()).toEqual([]);
  });

  it("is in Download my data, and only the person can forget it", async () => {
    const data = await exportUserData(userId, { client });
    expect(data.janePreferences.map((p) => p.label)).toContain("Paid on the 1st and the 15th");
    const [first] = await listPreferences(userId, { client });
    expect(await deletePreference(otherId, first.id, { client })).toBe(false);
    expect(await deletePreference(userId, first.id, { client })).toBe(true);
    expect((await listPreferences(userId, { client })).map((p) => p.id)).not.toContain(first.id);
  });
});
