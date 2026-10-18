import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import {
  LifeEventError,
  deleteLifeEvent,
  finishLifeEvent,
  listLifeEvents,
  startLifeEvent,
  toggleLifeEventItem,
} from "./life-events";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T12:00:00Z");

describe.runIf(url)("life-event checklists against a real database", () => {
  let client: PrismaClient;
  const users: string[] = [];
  async function person() {
    const user = await client.user.create({
      data: { email: `life-${crypto.randomUUID()}@example.com` },
    });
    users.push(user.id);
    return user.id;
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
  });

  it("starts a checklist, ticks and unticks items, and finishes it", async () => {
    const me = await person();
    const id = await startLifeEvent(me, "moving", { client, now: NOW });

    expect(await toggleLifeEventItem(me, id, "mail", { client })).toEqual({
      checked: true,
      label: "Forward your mail with the post office",
    });
    await toggleLifeEventItem(me, id, "budget", { client });
    expect((await toggleLifeEventItem(me, id, "mail", { client })).checked).toBe(false);

    let [event] = await listLifeEvents(me, { client });
    expect(event).toMatchObject({
      kind: "moving",
      startedOn: "2026-10-18",
      checkedItems: ["budget"],
      completedAt: null,
    });

    expect(await finishLifeEvent(me, id, { client, now: NOW })).toBe("moving");
    [event] = await listLifeEvents(me, { client });
    expect(event.completedAt).toEqual(NOW);
    // Once finished, the same kind can start again.
    await startLifeEvent(me, "moving", { client, now: NOW });
    expect((await listLifeEvents(me, { client })).map((e) => e.completedAt)).toEqual([null, NOW]);
  });

  it("allows one open checklist per kind, and only known kinds and items", async () => {
    const me = await person();
    const id = await startLifeEvent(me, "new_baby", { client, now: NOW });
    await expect(startLifeEvent(me, "new_baby", { client })).rejects.toThrow(
      "You already have a new baby checklist going.",
    );
    await expect(startLifeEvent(me, "divorce", { client })).rejects.toBeInstanceOf(LifeEventError);
    await expect(toggleLifeEventItem(me, id, "mail", { client })).rejects.toThrow(
      "That item isn't on this checklist.",
    );
  });

  it("never reads or changes another person's checklist", async () => {
    const me = await person();
    const other = await person();
    const theirs = await startLifeEvent(other, "new_job", { client, now: NOW });

    expect(await listLifeEvents(me, { client })).toEqual([]);
    await expect(toggleLifeEventItem(me, theirs, "paycheck", { client })).rejects.toThrow(
      "That checklist doesn't exist.",
    );
    await expect(finishLifeEvent(me, theirs, { client })).rejects.toBeInstanceOf(LifeEventError);
    await deleteLifeEvent(me, theirs, { client });

    const [still] = await listLifeEvents(other, { client });
    expect(still).toMatchObject({ id: theirs, checkedItems: [], completedAt: null });
    await deleteLifeEvent(other, theirs, { client });
    expect(await listLifeEvents(other, { client })).toEqual([]);
  });
});
