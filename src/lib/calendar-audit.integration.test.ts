import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";

import { createCalendarToken, turnOffCalendar, userForCalendarToken } from "./calendar";
import { signOutOtherSessions } from "./user-sessions";

// A read of who can give whom access: someone briefly on a signed-in device could make a calendar
// link, copy it, and go on reading merchants, medical bills and deposits. It never expires, nothing
// recorded it, and "Sign out other devices" only stopped it if another session was still there.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("a calendar link", () => {
  let client: PrismaClient;
  const people: string[] = [];
  const person = async () => {
    const { id } = await client.user.create({
      data: { email: `cal-${crypto.randomUUID()}@example.com` },
    });
    people.push(id);
    return id;
  };
  const events = (id: string) =>
    vi
      .mocked(logAudit)
      .mock.calls.filter(([actor]) => actor.id === id)
      .map(([, event]) => event as string);

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: people } } });
    await client.$disconnect();
  });

  it("is recorded when it's made and when it stops", async () => {
    const id = await person();
    await createCalendarToken(id, { client });
    await turnOffCalendar(id, { client });
    await turnOffCalendar(id, { client });
    const log = events(id);
    expect(log.filter((e) => e === "calendar_link_created")).toHaveLength(1);
    expect(log.filter((e) => e === "calendar_link_stopped")).toHaveLength(1);
  });

  it("stops on signing out other devices, even with no other session left", async () => {
    const id = await person();
    const token = await createCalendarToken(id, { client });
    expect(await userForCalendarToken(token, { client })).toBe(id);
    expect(await signOutOtherSessions(id, "this-session", { client })).toBe(0);
    expect(await userForCalendarToken(token, { client })).toBeNull();
  });
});
