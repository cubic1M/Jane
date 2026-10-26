import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

import { ERROR_ALERT_MINUTES, ERROR_DIGEST_KINDS } from "@/config/health";
import type { PrismaClient } from "@/generated/prisma/client";
import { alertError, digestLines, errorKind, safePath, sendErrorDigest } from "./error-alerts";

// Knowing when Jane breaks: an email per kind of error at most once an hour, a daily digest, and
// never anything personal in either.

const NOW = new Date("2026-10-26T08:00:00Z");
const MINUTE = 60_000;

// The two tables the alerts use, in memory.
function fakeClient(events: { message: string; path: string | null; createdAt: Date }[] = []) {
  const notices = new Map<string, Date>();
  const client = {
    healthNotice: {
      createMany: async ({ data }: { data: { key: string; reportedAt: Date }[] }) => {
        let count = 0;
        for (const d of data) {
          if (!notices.has(d.key)) {
            notices.set(d.key, d.reportedAt);
            count += 1;
          }
        }
        return { count };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { key: string; reportedAt: { lt: Date } };
        data: { reportedAt: Date };
      }) => {
        const at = notices.get(where.key);
        if (!at || at >= where.reportedAt.lt) return { count: 0 };
        notices.set(where.key, data.reportedAt);
        return { count: 1 };
      },
      deleteMany: async ({ where }: { where: { key: string } }) => {
        notices.delete(where.key);
        return { count: 1 };
      },
    },
    errorEvent: {
      findMany: async ({ where }: { where: { createdAt: { gte: Date; lt: Date } } }) =>
        events.filter(
          (e) => e.createdAt >= where.createdAt.gte && e.createdAt < where.createdAt.lt,
        ),
    },
  };
  return client as unknown as PrismaClient;
}

const PRIVATE = /ann@example\.com|sk_live|tok_|4111|Ann Lee|stack|at Object/;

describe("an error's kind and place, with nothing personal", () => {
  it("keeps the class of error and takes ids out of the path", () => {
    expect(errorKind("TypeError: Cannot read ann@example.com")).toBe("TypeError");
    expect(errorKind("something odd happened")).toBe("Error");
    expect(safePath("/report/cmvn11srd7fix8c0ayi4ir59j?from=x")).toBe("/report/:id");
    expect(safePath("/api/chat/act")).toBe("/api/chat/act");
    expect(safePath(null)).toBe("(no path)");
  });
});

describe("error alert emails", () => {
  const send = vi.fn();
  beforeEach(() => {
    send.mockReset();
    vi.stubEnv("ADMIN_EMAILS", "a@team.test, b@team.test");
    vi.stubEnv("APP_URL", "https://jane.test");
  });
  afterEach(() => vi.unstubAllEnvs());

  const error = {
    message: "TypeError: card 4111 for ann@example.com failed with sk_live_123 (Ann Lee)",
    path: "/api/plaid/item/abc123/refresh",
  };

  it("emails each admin once, with the kind and place only", async () => {
    const client = fakeClient();
    expect(await alertError(error, { client, now: NOW, send })).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    const [{ subject, text, html, to }] = send.mock.calls[0];
    expect(to).toBe("a@team.test");
    expect(subject).toBe("Jane error: TypeError on /api/plaid/item/:id/refresh");
    expect(text).toContain("https://jane.test/admin/errors");
    for (const body of [subject, text, html]) expect(body).not.toMatch(PRIVATE);
  });

  it("sends at most one per kind and place an hour, then again after", async () => {
    const client = fakeClient();
    await alertError(error, { client, now: NOW, send });
    send.mockClear();
    const later = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);
    expect(await alertError(error, { client, now: later(5), send })).toBe(false);
    expect(await alertError(error, { client, now: later(ERROR_ALERT_MINUTES - 1), send })).toBe(
      false,
    );
    expect(send).not.toHaveBeenCalled();
    // Another kind, or another place, is its own alert.
    expect(
      await alertError({ ...error, message: "RangeError: x" }, { client, now: later(6), send }),
    ).toBe(true);
    expect(await alertError(error, { client, now: later(ERROR_ALERT_MINUTES + 1), send })).toBe(
      true,
    );
  });

  it("sends nothing without ADMIN_EMAILS, and never throws when sending fails", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(await alertError(error, { client: fakeClient(), now: NOW, send })).toBe(false);
    expect(send).not.toHaveBeenCalled();
    vi.stubEnv("ADMIN_EMAILS", "a@team.test");
    const failing = vi.fn(async () => {
      throw new Error("Resend down");
    });
    await expect(
      alertError(error, { client: fakeClient(), now: NOW, send: failing }),
    ).resolves.toBe(false);
  });
});

describe("the daily error digest", () => {
  const send = vi.fn();
  beforeEach(() => {
    send.mockReset();
    vi.stubEnv("ADMIN_EMAILS", "a@team.test");
  });
  afterEach(() => vi.unstubAllEnvs());

  const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 60 * MINUTE);

  it("counts the last day's errors by kind and place, most first, once a day", async () => {
    const events = [
      { message: "TypeError: ann@example.com", path: "/home", createdAt: at(1) },
      { message: "TypeError: other", path: "/home", createdAt: at(2) },
      { message: "PrismaClientKnownRequestError: tok_9", path: "/report/abc123", createdAt: at(3) },
      // Older than a day: not in it.
      { message: "RangeError: old", path: "/old", createdAt: at(30) },
    ];
    const client = fakeClient(events);
    expect(await sendErrorDigest({ client, now: NOW, send })).toBe(3);
    expect(send).toHaveBeenCalledOnce();
    const [{ subject, text, html }] = send.mock.calls[0];
    expect(subject).toBe("Jane errors, last 24 hours: 3");
    expect(text).toContain("- 2 × TypeError on /home");
    expect(text).toContain("- 1 × PrismaClientKnownRequestError on /report/:id");
    expect(text).not.toContain("RangeError");
    for (const body of [subject, text, html]) expect(body).not.toMatch(PRIVATE);
    // Again the same day: nothing.
    expect(await sendErrorDigest({ client, now: NOW, send })).toBe(0);
    expect(send).toHaveBeenCalledOnce();
  });

  it("sends nothing on a day without errors", async () => {
    expect(await sendErrorDigest({ client: fakeClient(), now: NOW, send })).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("lists the top kinds and says how many more", () => {
    const many = Array.from({ length: ERROR_DIGEST_KINDS + 3 }, (_, i) => ({
      message: `E${String.fromCharCode(65 + i)}: x`,
      path: "/x",
    }));
    expect(digestLines(many)).toHaveLength(ERROR_DIGEST_KINDS + 3);
  });
});
