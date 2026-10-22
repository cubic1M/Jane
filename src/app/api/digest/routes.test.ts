import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, digestsUpdateMany, userUpdateMany, userFindUnique, userUpdate } = vi.hoisted(
  () => ({
    findUnique: vi.fn(),
    digestsUpdateMany: vi.fn(),
    userUpdateMany: vi.fn(),
    userFindUnique: vi.fn(),
    userUpdate: vi.fn(),
  }),
);

vi.mock("@/lib/rate-limit", () => ({
  limitOrNull: vi.fn(async () => null),
  hit: vi.fn(async () => ({ ok: true, remaining: 1, retryAfterSeconds: 0 })),
  ipKey: vi.fn(() => "ip"),
}));
vi.mock("@/lib/db", () => ({
  db: {
    digest: { findUnique },
    user: { updateMany: userUpdateMany, findUnique: userFindUnique, update: userUpdate },
  },
}));
vi.mock("@/lib/db-scoped", () => ({
  scopedFor: vi.fn(() => ({ digests: { updateMany: digestsUpdateMany } })),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/digest/send", () => ({ runDigests: vi.fn() }));
vi.mock("@/lib/health", () => ({
  recordRun: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
  reportMissedJobs: vi.fn(async () => []),
}));
vi.mock("@/lib/jobs", () => ({
  runDueJobs: vi.fn(async () => ({ done: 0, retried: 0, failed: 0 })),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { track } from "@/lib/analytics";
import { runDigests } from "@/lib/digest/send";
import { unsubscribeToken } from "@/lib/digest/unsubscribe";
import { GET as cron } from "../cron/digest/route";
import { POST as unsubscribe } from "../unsubscribe/route";
import { GET as click } from "./click/route";

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-secret");
  vi.stubEnv("CRON_SECRET", "cron-secret");
  findUnique.mockReset();
  digestsUpdateMany.mockReset();
  userUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  userFindUnique.mockReset().mockResolvedValue({ alertPrefs: { low_balance: "off" } });
  userUpdate.mockReset();
  vi.mocked(track).mockReset();
  vi.mocked(runDigests)
    .mockReset()
    .mockResolvedValue({
      users: 1,
      sent: 0,
      skipped: 0,
      alreadySent: 0,
      failed: 0,
      previews: [{ userId: "u1", subject: "s", text: "t" }],
    });
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/digest/click", () => {
  it("records the first open and redirects with UTM parameters", async () => {
    findUnique.mockResolvedValue({ id: "d1", userId: "u1" });

    const response = await click(
      new Request("https://app.example.com/api/digest/click?d=d1&to=/actions"),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/actions?utm_source=digest&utm_medium=email&utm_campaign=weekly",
    );
    expect(digestsUpdateMany).toHaveBeenCalledWith({
      where: { id: "d1", openedAt: null },
      data: { openedAt: expect.any(Date) },
    });
    expect(track).toHaveBeenCalledWith("u1", "digest_clicked", { to: "/actions" });
  });

  it("never redirects off the site, and ignores unknown digests", async () => {
    findUnique.mockResolvedValue(null);

    const response = await click(
      new Request("https://app.example.com/api/digest/click?d=nope&to=https://evil.example.com"),
    );

    expect(new URL(response.headers.get("location") ?? "").origin).toBe("https://app.example.com");
    expect(track).not.toHaveBeenCalled();
  });
});

describe("POST /api/unsubscribe", () => {
  const post = (query: string) =>
    unsubscribe(
      new Request(`https://app.example.com/api/unsubscribe?${query}`, { method: "POST" }),
    );

  it("turns the digest off without signing in (one-click)", async () => {
    const response = await post(`token=${unsubscribeToken("u1")}`);

    expect(response.status).toBe(200);
    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { digestEnabled: false },
    });
    expect(track).toHaveBeenCalledWith("u1", "digest_unsubscribed", {});
  });

  it("sends the page's button back to a confirmation", async () => {
    const response = await post(`token=${unsubscribeToken("u1")}&from=page`);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/unsubscribe?done=1&what=digest",
    );
  });

  it("with what=alerts, stops alert emails but keeps the digest and in-app alerts", async () => {
    const response = await post(`token=${unsubscribeToken("u1")}&what=alerts&from=page`);

    expect(response.headers.get("location")).toBe(
      "https://app.example.com/unsubscribe?done=1&what=alerts",
    );
    const { alertPrefs } = userUpdate.mock.calls[0][0].data;
    expect(Object.values(alertPrefs)).not.toContain("email");
    expect(alertPrefs).toMatchObject({ large_charge: "app", low_balance: "off" });
    expect(userUpdateMany).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("u1", "alert_emails_unsubscribed", {});
  });

  it("rejects a forged token", async () => {
    expect((await post("token=abc.def")).status).toBe(400);
    expect(userUpdateMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/digest", () => {
  const call = (query = "", auth = "Bearer cron-secret") =>
    cron(
      new Request(`https://app.example.com/api/cron/digest${query}`, {
        headers: { authorization: auth },
      }),
    );

  it("refuses calls without the cron secret", async () => {
    expect((await call("", "Bearer nope")).status).toBe(401);
    expect(runDigests).not.toHaveBeenCalled();
  });

  it("returns rendered previews only in a dry run", async () => {
    expect(await (await call("?dry_run=1")).json()).toMatchObject({ previews: [{ userId: "u1" }] });
    expect(runDigests).toHaveBeenLastCalledWith({ dryRun: true });

    expect(await (await call()).json()).not.toHaveProperty("previews");
    expect(runDigests).toHaveBeenLastCalledWith({ dryRun: false });
  });
});
