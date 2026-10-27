import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, headers } = vi.hoisted(() => ({ create: vi.fn(), headers: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { auditLog: { create } } }));
vi.mock("next/headers", () => ({ headers }));

import { ACCESS_EVENTS } from "@/config/access-log";
import { isAccessEvent, logAudit, safeMetadata, SYSTEM_ACTOR } from "./audit";

const NO_REQUEST = { ip: null, user_agent: null, city: null, country: null };

describe("logAudit", () => {
  beforeEach(() => {
    create.mockReset().mockResolvedValue({});
    // Outside a request, as in a cron job.
    headers.mockReset().mockRejectedValue(new Error("outside a request scope"));
  });

  it("writes actor, event, target and metadata to audit_log", async () => {
    await logAudit(
      { type: "user", id: "user_1" },
      "insurance_policy_saved",
      { type: "user", id: "user_1" },
      { kind: "home" },
    );

    expect(create).toHaveBeenCalledWith({
      data: {
        actorType: "user",
        actorId: "user_1",
        event: "insurance_policy_saved",
        targetType: "user",
        targetId: "user_1",
        metadata: { kind: "home" },
      },
    });
  });

  it("adds the time's request details and the outcome to access-log entries", async () => {
    headers.mockResolvedValue(
      new Headers({
        "x-forwarded-for": "203.0.113.7, 10.0.0.1",
        "user-agent": "Mozilla/5.0 (Macintosh) Chrome/130",
        "x-vercel-ip-city": "S%C3%A3o%20Paulo",
        "x-vercel-ip-country": "BR",
        cookie: "authjs.session-token=abc",
        authorization: "Bearer xyz",
      }),
    );
    await logAudit(
      { type: "user", id: "u1" },
      "user_signed_in",
      { type: "user", id: "u1" },
      {
        method: "email",
      },
    );

    expect(create.mock.calls[0][0].data.metadata).toEqual({
      outcome: "success",
      ip: "203.0.113.7",
      user_agent: "Mozilla/5.0 (Macintosh) Chrome/130",
      city: "São Paulo",
      country: "BR",
      method: "email",
    });
    expect(JSON.stringify(create.mock.calls)).not.toMatch(/abc|xyz|Bearer/);
  });

  it("marks failures, and uses the headers it's given (the proxy has no request scope)", async () => {
    await logAudit(
      SYSTEM_ACTOR,
      "sign_in_failed",
      null,
      { reason: "Verification" },
      {
        headers: new Headers({ "x-real-ip": "198.51.100.4" }),
      },
    );
    expect(create.mock.calls[0][0].data.metadata).toEqual({
      ...NO_REQUEST,
      ip: "198.51.100.4",
      outcome: "failure",
      reason: "Verification",
    });
    expect(headers).not.toHaveBeenCalled();
  });

  it("works outside a request, with no details", async () => {
    await logAudit(SYSTEM_ACTOR, "item_removed", { type: "plaid_item", id: "i1" });
    expect(create.mock.calls[0][0].data.metadata).toEqual({ ...NO_REQUEST, outcome: "success" });
  });

  it("allows system events without a target or metadata", async () => {
    await logAudit(SYSTEM_ACTOR, "job_retried", null);

    expect(create).toHaveBeenCalledWith({
      data: {
        actorType: "system",
        actorId: null,
        event: "job_retried",
        targetType: null,
        targetId: null,
        metadata: {},
      },
    });
  });

  it("throws when the write fails, so a missing audit record is never silent", async () => {
    create.mockRejectedValue(new Error("db down"));

    await expect(
      logAudit(SYSTEM_ACTOR, "user_signed_in", { type: "user", id: "user_1" }),
    ).rejects.toThrow("db down");
  });
});

describe("secrets never reach the audit log", () => {
  it("drops keys named like credentials and scrubs credentials out of values", () => {
    expect(
      safeMetadata({
        accessToken: "access-sandbox-123",
        session_token: "abc",
        password: "hunter2",
        apiKey: "k",
        method: "email",
        note: "sent with sk_live_abcdef123 and access-production-9f8e",
        count: 3,
      }),
    ).toEqual({ method: "email", note: "sent with [key] and [plaid-token]", count: 3 });
  });

  it("knows which events are access-log entries", () => {
    expect(isAccessEvent("user_signed_in")).toBe(true);
    expect(isAccessEvent("admin_page_viewed")).toBe(true);
    expect(isAccessEvent("insurance_policy_saved")).toBe(false);
    expect(new Set(ACCESS_EVENTS).size).toBe(ACCESS_EVENTS.length);
  });
});
