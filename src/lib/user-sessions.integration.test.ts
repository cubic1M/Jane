import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_SEEN_EVERY_MINUTES, USER_AGENT_MAX_LENGTH } from "@/config/sessions";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { adminSessionState } from "./admin-gate";
import { createAuthAdapter } from "./auth-adapter";
import {
  listSessions,
  noteSessionSeen,
  signOutOtherSessions,
  signOutSession,
} from "./user-sessions";

// Devices and sessions (spec step 73), against a real, migrated Postgres (see
// src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

describe.runIf(url)("devices and sessions against a real database", () => {
  let client: PrismaClient;
  const ids: string[] = [];
  const now = new Date("2026-10-18T12:00:00Z");
  const day = 86_400_000;

  async function person() {
    const user = await client.user.create({
      data: { email: `sessions-${crypto.randomUUID()}@example.com` },
    });
    ids.push(user.id);
    return user.id;
  }

  async function session(
    userId: string,
    {
      userAgent = null,
      expires = new Date(now.getTime() + day),
      lastSeenAt = null,
    }: { userAgent?: string | null; expires?: Date; lastSeenAt?: Date | null } = {},
  ) {
    const token = `sessions-${crypto.randomUUID()}`;
    const row = await client.session.create({
      data: { userId, sessionToken: token, expires, userAgent, lastSeenAt, createdAt: now },
    });
    return { id: row.id, token };
  }

  const exists = async (id: string) => Boolean(await client.session.findUnique({ where: { id } }));

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: ids } } });
    await client.$disconnect();
  });

  beforeEach(() => {
    vi.mocked(logAudit).mockReset();
    vi.mocked(track).mockReset();
  });

  it("lists only the person's own unexpired sessions, this one marked and first", async () => {
    const me = await person();
    const someoneElse = await person();
    const here = await session(me, { userAgent: MAC_CHROME });
    const phone = await session(me, {
      userAgent: IPHONE,
      lastSeenAt: new Date(now.getTime() - 3 * 60 * 60_000),
    });
    await session(me, { expires: new Date(now.getTime() - 1000) });
    await session(someoneElse, { userAgent: MAC_CHROME });

    const list = await listSessions(me, here.token, { client, now });

    expect(list).toEqual([
      {
        id: here.id,
        device: "Mac · Chrome",
        signedIn: "2026-10-18",
        lastActive: "Active now",
        current: true,
      },
      {
        id: phone.id,
        device: "iPhone · Safari",
        signedIn: "2026-10-18",
        lastActive: "3 hours ago",
        current: false,
      },
    ]);
  });

  it("never returns a session token to the page", async () => {
    const me = await person();
    const here = await session(me);
    await session(me);

    const list = await listSessions(me, here.token, { client, now });

    expect(list).toHaveLength(2);
    for (const row of list) {
      expect(Object.keys(row).sort()).toEqual([
        "current",
        "device",
        "id",
        "lastActive",
        "signedIn",
      ]);
      expect(JSON.stringify(row)).not.toContain("sessions-");
    }
  });

  it("doesn't mark another person's cookie as this device", async () => {
    const me = await person();
    const theirs = await session(await person());
    await session(me);
    const list = await listSessions(me, theirs.token, { client, now });
    expect(list.map((s) => s.current)).toEqual([false]);
  });

  it("signs out one other session, and a signed-out session no longer authenticates", async () => {
    const me = await person();
    const here = await session(me);
    const phone = await session(me);
    const adapter = createAuthAdapter(client);
    expect(await adapter.getSessionAndUser?.(phone.token)).not.toBeNull();

    expect(await signOutSession(me, phone.id, here.token, { client })).toBe("ok");

    expect(await exists(phone.id)).toBe(false);
    expect(await exists(here.id)).toBe(true);
    // Auth.js looks the cookie up in this table on every request.
    expect(await adapter.getSessionAndUser?.(phone.token)).toBeNull();
    expect(await adminSessionState(phone.token, { client, now })).toBe("none");
    expect(await adapter.getSessionAndUser?.(here.token)).not.toBeNull();
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      { type: "user", id: me },
      "session_signed_out",
      { type: "session", id: phone.id },
    );
    expect(vi.mocked(track)).toHaveBeenCalledWith(me, "session_signed_out", { count: 1 });
  });

  it("never signs out the current session by id", async () => {
    const me = await person();
    const here = await session(me);
    expect(await signOutSession(me, here.id, here.token, { client })).toBe("not_found");
    expect(await exists(here.id)).toBe(true);
    expect(vi.mocked(logAudit)).not.toHaveBeenCalled();
  });

  it("refuses another person's session id", async () => {
    const me = await person();
    const here = await session(me);
    const theirs = await session(await person());

    expect(await signOutSession(me, theirs.id, here.token, { client })).toBe("not_found");
    expect(await signOutSession(me, "no-such-session", here.token, { client })).toBe("not_found");

    expect(await exists(theirs.id)).toBe(true);
    expect(vi.mocked(logAudit)).not.toHaveBeenCalled();
    expect(vi.mocked(track)).not.toHaveBeenCalled();
  });

  it("does nothing without this session's cookie", async () => {
    const me = await person();
    const phone = await session(me);
    expect(await signOutSession(me, phone.id, undefined, { client })).toBe("not_found");
    expect(await signOutOtherSessions(me, undefined, { client })).toBe(0);
    expect(await exists(phone.id)).toBe(true);
  });

  it("signs out every other session of the person's, never this one or anyone else's", async () => {
    const me = await person();
    const here = await session(me);
    const phone = await session(me);
    const laptop = await session(me);
    const theirs = await session(await person());
    // Already expired: not on the list, so not in the count (the daily cleanup removes it).
    await session(me, { expires: new Date(now.getTime() - 1000) });

    expect(await signOutOtherSessions(me, here.token, { client, now })).toBe(2);

    expect(await exists(here.id)).toBe(true);
    expect(await exists(phone.id)).toBe(false);
    expect(await exists(laptop.id)).toBe(false);
    expect(await exists(theirs.id)).toBe(true);
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      { type: "user", id: me },
      "other_sessions_signed_out",
      { type: "user", id: me },
      { count: 2 },
    );
    expect(vi.mocked(track)).toHaveBeenCalledWith(me, "other_sessions_signed_out", { count: 2 });
  });

  it("notes the device and time at most every few minutes, with no IP address", async () => {
    const me = await person();
    const here = await session(me);
    const read = () =>
      client.session.findUniqueOrThrow({
        where: { id: here.id },
        select: { userAgent: true, lastSeenAt: true },
      });

    await noteSessionSeen(here.token, `  ${IPHONE}${"x".repeat(400)}`, { client, now });
    let row = await read();
    expect(row.lastSeenAt).toEqual(now);
    expect(row.userAgent).toHaveLength(USER_AGENT_MAX_LENGTH);
    expect(row.userAgent?.startsWith("Mozilla/5.0 (iPhone")).toBe(true);

    // Within the window: no write.
    const soon = new Date(now.getTime() + (SESSION_SEEN_EVERY_MINUTES - 1) * 60_000);
    await noteSessionSeen(here.token, MAC_CHROME, { client, now: soon });
    row = await read();
    expect(row.lastSeenAt).toEqual(now);
    expect(row.userAgent?.startsWith("Mozilla/5.0 (iPhone")).toBe(true);

    // After it: written again; a missing user agent keeps the one we have.
    const later = new Date(now.getTime() + (SESSION_SEEN_EVERY_MINUTES + 1) * 60_000);
    await noteSessionSeen(here.token, null, { client, now: later });
    row = await read();
    expect(row.lastSeenAt).toEqual(later);
    expect(row.userAgent?.startsWith("Mozilla/5.0 (iPhone")).toBe(true);

    // The sessions table has nowhere to put an IP address.
    const columns = await client.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'sessions'`;
    expect(columns.map((c) => c.column_name).filter((c) => /(^|_)ip(_|$)|addr/.test(c))).toEqual(
      [],
    );
  });
});
