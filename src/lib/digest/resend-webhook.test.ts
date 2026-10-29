import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";

const { digestsUpdateMany } = vi.hoisted(() => ({ digestsUpdateMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/db-scoped", () => ({
  scopedFor: vi.fn(() => ({ digests: { updateMany: digestsUpdateMany } })),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { recordEmailEvent, verifyResendSignature } from "./resend-webhook";

const SECRET = `whsec_${Buffer.from("a test signing key").toString("base64")}`;
const NOW = new Date("2026-10-19T15:00:00Z");
const nowSeconds = String(NOW.getTime() / 1000);

function signed(body: string, { secret = SECRET, timestamp = nowSeconds, id = "msg_1" } = {}) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return new Headers({
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${signature}`,
  });
}

describe("verifyResendSignature", () => {
  const body = JSON.stringify({ type: "email.opened", data: { email_id: "re_1" } });

  it("accepts a delivery signed with the endpoint's secret", () => {
    expect(verifyResendSignature(body, signed(body), SECRET, NOW)).toBe(true);
  });

  it("accepts any one of several signatures while a secret rotates", () => {
    const headers = signed(body);
    headers.set("svix-signature", `v1,bm9wZQ== ${headers.get("svix-signature")}`);
    expect(verifyResendSignature(body, headers, SECRET, NOW)).toBe(true);
  });

  it("refuses a changed body, another secret, no secret, or missing headers", () => {
    expect(verifyResendSignature(`${body} `, signed(body), SECRET, NOW)).toBe(false);
    const other = `whsec_${Buffer.from("someone else").toString("base64")}`;
    expect(verifyResendSignature(body, signed(body, { secret: other }), SECRET, NOW)).toBe(false);
    expect(verifyResendSignature(body, signed(body), undefined, NOW)).toBe(false);
    expect(verifyResendSignature(body, new Headers(), SECRET, NOW)).toBe(false);
  });

  it("refuses an old delivery, so it can't be replayed", () => {
    const old = String(NOW.getTime() / 1000 - 10 * 60);
    expect(verifyResendSignature(body, signed(body, { timestamp: old }), SECRET, NOW)).toBe(false);
  });
});

describe("recordEmailEvent", () => {
  const findUnique = vi.fn();
  const userUpdateMany = vi.fn();
  const client = {
    digest: { findUnique },
    user: { updateMany: userUpdateMany },
  } as unknown as PrismaClient;

  beforeEach(() => {
    findUnique.mockReset().mockResolvedValue({ id: "d1", userId: "u1" });
    digestsUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    userUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    vi.mocked(track).mockReset();
    vi.mocked(logAudit).mockReset();
  });

  const event = (type: string, emailId: unknown = "re_1") => ({
    type,
    data: { email_id: emailId },
  });

  it("keeps the first open of a weekly email, and counts it once", async () => {
    expect(await recordEmailEvent(event("email.opened"), { client, now: NOW })).toBe("opened");
    expect(findUnique).toHaveBeenCalledWith({
      where: { resendId: "re_1" },
      select: { id: true, userId: true },
    });
    expect(digestsUpdateMany).toHaveBeenCalledWith({
      where: { id: "d1", emailOpenedAt: null },
      data: { emailOpenedAt: NOW },
    });
    expect(track).toHaveBeenCalledWith("u1", "digest_opened", { digest_id: "d1" });

    digestsUpdateMany.mockResolvedValue({ count: 0 });
    vi.mocked(track).mockReset();
    await recordEmailEvent(event("email.opened"), { client, now: NOW });
    expect(track).not.toHaveBeenCalled();
  });

  it("turns the weekly email off on a spam complaint, in the audit log", async () => {
    expect(await recordEmailEvent(event("email.complained"), { client, now: NOW })).toBe(
      "complained",
    );
    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: "u1", digestEnabled: true },
      data: { digestEnabled: false },
    });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "system", id: null },
      "digest_unsubscribed",
      { type: "user", id: "u1" },
      { why: "spam_complaint" },
    );
  });

  it("ignores other emails, other events and bad ids", async () => {
    findUnique.mockResolvedValue(null);
    expect(await recordEmailEvent(event("email.opened"), { client })).toBe("ignored");
    findUnique.mockResolvedValue({ id: "d1", userId: "u1" });
    expect(await recordEmailEvent(event("email.delivered"), { client })).toBe("ignored");
    expect(await recordEmailEvent(event("email.opened", 42), { client })).toBe("ignored");
    expect(digestsUpdateMany).not.toHaveBeenCalled();
    expect(userUpdateMany).not.toHaveBeenCalled();
  });
});
