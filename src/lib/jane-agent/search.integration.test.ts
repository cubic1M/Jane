import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { createCheckPerson, deleteCheckPerson } from "./checks/person";
import { pinnedMessages, setPinned } from "./messages";
import { runJaneAgent } from "./run";
import { searchChat } from "./search";
import { sendToJane } from "./typing";

// Spec step 96 against a real, migrated Postgres: search finds words, merchants, amounts and
// days in the person's own chat and never anyone else's; pins are the person's own.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe.runIf(url)("history and search against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let otherId: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = await createCheckPerson({ client, now: NOW });
    otherId = await createCheckPerson({ client, now: NOW });
    await sendToJane(userId, "how much is Netflix", { client, now: at(1) });
    await sendToJane(otherId, "how much is Netflix", { client, now: at(1) });
    await sendToJane(otherId, "secret zebra words", { client, now: at(2) });
  }, 120_000);
  afterAll(async () => {
    await deleteCheckPerson(userId, { client });
    await deleteCheckPerson(otherId, { client });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const ids = async (person: string) =>
    new Set((await client.janeMessage.findMany({ where: { userId: person } })).map((m) => m.id));

  it("finds words, a merchant and an amount, only in the person's own chat", async () => {
    const mine = await ids(userId);
    const netflix = await searchChat(userId, "netflix", { client, now: at(5) });
    expect(netflix.length).toBeGreaterThan(0);
    expect(netflix.every((r) => mine.has(r.id))).toBe(true);
    const amount = await searchChat(userId, "$17.99", { client, now: at(5) });
    expect(amount.some((r) => /\$17\.99/.test(r.body))).toBe(true);
    expect(await searchChat(userId, "zebra", { client, now: at(5) })).toEqual([]);
    expect(netflix[0].href).toMatch(/^\/chat(?:\?pages=\d+)?#/);
  });

  it("finds a day, in the person's timezone", async () => {
    const found = await searchChat(userId, "Oct 18 netflix", {
      client,
      now: at(5),
      timezone: "America/Los_Angeles",
    });
    expect(found.length).toBeGreaterThan(0);
    expect(await searchChat(userId, "Oct 17 netflix", { client, now: at(5) })).toEqual([]);
  });

  it("answers a typed search with the newest few (no search page any more)", async () => {
    const { reply } = await sendToJane(userId, "search for netflix", { client, now: at(6) });
    expect(reply.body).toMatch(/^I found \d+ messages? with "netflix", the newest first\./);
    expect(reply.actions.filter((a) => a.kind === "link")).toEqual([]);
  });

  it("pins only the person's own messages", async () => {
    const [mine] = await client.janeMessage.findMany({
      where: { userId, kind: "reply" },
      take: 1,
    });
    const [theirs] = await client.janeMessage.findMany({ where: { userId: otherId }, take: 1 });
    expect(await setPinned(userId, theirs.id, true, { client })).toBe(false);
    expect(await pinnedMessages(otherId, { client })).toEqual([]);
    expect(await setPinned(userId, mine.id, true, { client })).toBe(true);
    expect((await pinnedMessages(userId, { client })).map((m) => m.id)).toEqual([mine.id]);
    await setPinned(userId, mine.id, false, { client });
    expect(await pinnedMessages(userId, { client })).toEqual([]);
  });

  it("says what last week covered in Monday's brief, not a message of its own", async () => {
    // Monday 9am in Los Angeles; the messages above were the week before. The week's summary
    // is a line of the brief (docs/feature-audit.md, cluster 2).
    const monday = new Date("2026-10-19T16:00:00Z");
    await runJaneAgent(userId, { client, now: monday, trigger: "cron" });
    const posted = await client.janeMessage.findMany({
      where: { userId, createdAt: { gte: monday } },
      orderBy: { createdAt: "asc" },
    });
    expect(posted.map((m) => m.dedupeKey)).not.toContain("week:2026-10-19");
    const brief = posted.find((m) => m.dedupeKey === "brief:2026-10-19");
    expect(brief?.body).toMatch(/^The week of Oct 12: .*we covered \d+ questions? you asked/m);
  });
});
