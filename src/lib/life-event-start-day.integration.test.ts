import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { listLifeEvents, startLifeEvent } from "./life-events";

// Debugger 11-13: a life-event checklist was "started" on the UTC day of the moment it was
// started, so at 7pm in Los Angeles it read as started tomorrow. It's the person's own day.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("a checklist's start day", () => {
  let client: PrismaClient;
  const made: string[] = [];
  const person = async (timezone: string) => {
    const user = await client.user.create({
      data: { email: `life-day-${crypto.randomUUID()}@example.com`, timezone },
    });
    made.push(user.id);
    return user.id;
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
  });

  it("is the person's own day either side of midnight UTC", async () => {
    // 7pm in Los Angeles on Nov 12 is 03:00 on Nov 13 in UTC.
    const now = new Date("2026-11-13T03:00:00Z");
    const la = await person("America/Los_Angeles");
    await startLifeEvent(la, "moving", { client, now });
    expect((await listLifeEvents(la, { client }))[0]?.startedOn).toBe("2026-11-12");

    const london = await person("Europe/London");
    await startLifeEvent(london, "moving", { client, now });
    expect((await listLifeEvents(london, { client }))[0]?.startedOn).toBe("2026-11-13");
  });
});
