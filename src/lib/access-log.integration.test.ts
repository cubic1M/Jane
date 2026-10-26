import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The access log writes through the app's default database client, so point it at the
// scratch database before anything imports it.
vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

const { requestHeaders, cookieGet, currentSession } = vi.hoisted(() => ({
  requestHeaders: { value: new Headers() },
  cookieGet: vi.fn(),
  currentSession: { value: null as { user: { id: string } } | null },
}));
vi.mock("next/headers", () => ({
  headers: async () => requestHeaders.value,
  cookies: async () => ({ get: cookieGet, set: vi.fn() }),
}));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("@/auth", () => ({
  auth: async () => currentSession.value,
  signIn: vi.fn(),
  signOut: vi.fn(),
  googleEnabled: false,
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { PrismaClient } from "@/generated/prisma/client";
import { logAdminAccess } from "./admin-access";
import { logAudit } from "./audit";
import { logAuthError, recordFailedSignIn, recordSignIn } from "./auth-events";
import { parseFilters, recentActivity, searchAccessLog } from "./access-log";
import { signOutToHome } from "./auth-actions";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

const SECRETS = {
  session: "session-token-4f9a1c7e2b",
  bearer: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
  plaid: "access-production-6b1e9d2a-7c3f",
  query: "magic-link-token-0d5e8b",
};

const browser = (ip: string, extra: Record<string, string> = {}) =>
  new Headers({
    "x-forwarded-for": `${ip}, 10.0.0.1`,
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 Safari/537.36",
    "x-vercel-ip-city": "Berlin",
    "x-vercel-ip-country": "DE",
    cookie: `authjs.session-token=${SECRETS.session}`,
    authorization: SECRETS.bearer,
    ...extra,
  });

describe.runIf(url)("the access log against a real database", () => {
  let client: PrismaClient;
  const tag = crypto.randomUUID().slice(0, 8);
  const userId = `al-user-${tag}`;
  const otherId = `al-other-${tag}`;
  const adminId = `al-admin-${tag}`;
  const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;

  const rows = (where: object = {}) =>
    client.auditLog.findMany({
      where: {
        OR: [
          { actorId: { in: [userId, otherId, adminId] } },
          { metadata: { path: ["ip"], equals: ip } },
        ],
        ...where,
      },
      orderBy: { createdAt: "asc" },
    });

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    for (const id of [userId, otherId, adminId]) {
      await client.user.create({ data: { id, email: `${id}@example.test` } });
    }
  });

  beforeEach(() => {
    requestHeaders.value = browser(ip);
    cookieGet.mockReturnValue(undefined);
  });

  afterAll(async () => {
    await client.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: [userId, otherId, adminId] } },
          { metadata: { path: ["ip"], equals: ip } },
        ],
      },
    });
    await client.user.deleteMany({ where: { id: { in: [userId, otherId, adminId] } } });
    await client.$disconnect();
  });

  it("records a sign-in with the time, IP, browser, place and outcome", async () => {
    const before = new Date();
    await recordSignIn({
      user: { id: userId, email: `${userId}@example.test` },
      account: { provider: "resend" },
    });
    const [entry] = await rows({ event: "user_signed_in", actorId: userId });
    expect(entry.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(entry).toMatchObject({ actorType: "user", targetType: "user", targetId: userId });
    expect(entry.metadata).toEqual({
      outcome: "success",
      ip,
      user_agent: expect.stringContaining("Chrome/130"),
      city: "Berlin",
      country: "DE",
      method: "email",
    });
  });

  it("records a sign-out with whose session it was", async () => {
    currentSession.value = { user: { id: userId } };
    await signOutToHome();
    const [entry] = await rows({ event: "user_signed_out", actorId: userId });
    expect(entry.metadata).toMatchObject({ outcome: "success", ip });
  });

  it("records failed sign-ins, why, and never the address tried", async () => {
    await recordFailedSignIn("rate_limited");
    logAuthError(
      Object.assign(new Error("Read more at https://errors.authjs.dev"), { type: "Verification" }),
    );
    await vi.waitFor(async () => expect(await rows({ event: "sign_in_failed" })).toHaveLength(2));
    const failed = await rows({ event: "sign_in_failed" });
    expect(failed.map((r) => r.metadata)).toEqual([
      expect.objectContaining({ outcome: "failure", reason: "rate_limited", ip }),
      expect.objectContaining({ outcome: "failure", reason: "Verification", ip }),
    ]);
    expect(failed.every((r) => r.actorType === "system" && r.actorId === null)).toBe(true);
  });

  it("records MFA changes, bank links, data downloads and deletions with the request details", async () => {
    for (const event of [
      "mfa_enabled",
      "mfa_failed",
      "item_linked",
      "data_exported",
      "user_data_deleted",
    ] as const) {
      await logAudit({ type: "user", id: otherId }, event, { type: "user", id: otherId });
    }
    const entries = await rows({ actorId: otherId });
    expect(entries.map((r) => [r.event, (r.metadata as { outcome: string }).outcome])).toEqual([
      ["mfa_enabled", "success"],
      ["mfa_failed", "failure"],
      ["item_linked", "success"],
      ["data_exported", "success"],
      ["user_data_deleted", "success"],
    ]);
    expect(entries.every((r) => (r.metadata as { ip: string }).ip === ip)).toBe(true);
  });

  it("records every admin page view and action, not prefetches, without the query string", async () => {
    const headers = browser(ip);
    await logAdminAccess(adminId, { method: "GET", pathname: "/admin/queue", headers });
    await logAdminAccess(adminId, {
      method: "POST",
      pathname: "/admin/invites",
      headers: browser(ip, { "next-action": "abc" }),
    });
    await logAdminAccess(adminId, {
      method: "GET",
      pathname: "/admin/metrics",
      headers: browser(ip, { "next-router-prefetch": "1" }),
    });
    const entries = await rows({ actorId: adminId });
    expect(
      entries.map((r) => [r.event, r.actorType, (r.metadata as { path: string }).path]),
    ).toEqual([
      ["admin_page_viewed", "admin", "/admin/queue"],
      ["admin_action", "admin", "/admin/invites"],
    ]);
  });

  it("shows a person only their own recent activity, in their words", async () => {
    const mine = await recentActivity(userId, { client });
    expect(mine.map((a) => a.what)).toEqual(["Signed out", "Signed in"]);
    expect(mine[0]).toMatchObject({ device: "Mac · Chrome", place: "Berlin, DE", failed: false });
    const theirs = await recentActivity(otherId, { client });
    expect(theirs.map((a) => a.what)).toEqual([
      "Downloaded your data",
      "Linked a bank",
      "Wrong two-factor code",
      "Turned on two-factor",
    ]);
    expect(theirs.find((a) => a.what === "Wrong two-factor code")?.failed).toBe(true);
  });

  it("lets the team filter by person (id or email), IP, outcome, event and date", async () => {
    const search = (params: Record<string, string>) =>
      searchAccessLog(parseFilters(params), { client });

    const byEmail = await search({ actor: `${otherId}@example.test` });
    expect(byEmail.entries.map((e) => e.event)).toContain("mfa_failed");
    expect(
      byEmail.entries.every((e) => e.actor.includes(otherId) || e.target?.includes(otherId)),
    ).toBe(true);

    const failures = await search({ ip, outcome: "failure" });
    expect(new Set(failures.entries.map((e) => e.event))).toEqual(
      new Set(["sign_in_failed", "mfa_failed"]),
    );

    const views = await search({ actor: adminId, event: "admin_page_viewed" });
    expect(views.entries).toHaveLength(1);
    expect(views.entries[0]).toMatchObject({ ip, place: "Berlin, DE", detail: "/admin/queue" });

    expect((await search({ ip, to: "2000-01-01" })).entries).toEqual([]);
    expect((await search({ actor: "nobody@example.test" })).entries).toEqual([]);
    // Unknown filters are ignored, never passed through.
    expect(
      parseFilters({ event: "drop table", outcome: "maybe", from: "yesterday" }),
    ).toMatchObject({
      event: null,
      outcome: null,
      from: null,
    });
  });

  it("never stores a secret: no cookie, bearer token, Plaid token or link token", async () => {
    await logAdminAccess(adminId, {
      method: "GET",
      pathname: `/admin/actions/x?token=${SECRETS.query}`,
      headers: browser(ip),
    });
    // Even a caller that wrongly passes one.
    await logAudit({ type: "user", id: userId }, "item_linked", null, {
      accessToken: SECRETS.plaid,
      note: `exchanged ${SECRETS.plaid}`,
    });
    const stored = JSON.stringify(await rows());
    for (const secret of Object.values(SECRETS)) {
      expect(stored).not.toContain(secret);
    }
    expect(stored).not.toContain("eyJ");
  });
});
