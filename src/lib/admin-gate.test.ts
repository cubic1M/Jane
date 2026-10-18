import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import type { PrismaClient } from "@/generated/prisma/client";
import { adminSessionState, sessionTokenFrom } from "./admin-gate";

const NOW = new Date("2026-10-18T12:00:00Z");
const LIVE = new Date("2026-10-19T00:00:00Z");
const clientWith = (session: unknown) =>
  ({ session: { findUnique: vi.fn().mockResolvedValue(session) } }) as unknown as PrismaClient;
const state = (session: unknown, token: string | undefined = "t") =>
  adminSessionState(token, { client: clientWith(session), now: NOW });

describe("adminSessionState", () => {
  it("is verified only for a live admin session with a two-factor code entered", async () => {
    expect(await state({ expires: LIVE, mfaVerifiedAt: NOW, user: { role: "admin" } })).toBe(
      "verified",
    );
    expect(await state({ expires: LIVE, mfaVerifiedAt: null, user: { role: "admin" } })).toBe(
      "needs_mfa",
    );
  });

  it("is none for non-admins, expired sessions and no session", async () => {
    expect(await state({ expires: LIVE, mfaVerifiedAt: NOW, user: { role: "user" } })).toBe("none");
    expect(
      await state({
        expires: new Date("2026-10-17T00:00:00Z"),
        mfaVerifiedAt: NOW,
        user: { role: "admin" },
      }),
    ).toBe("none");
    expect(await state(null)).toBe("none");
    expect(await state(null, undefined)).toBe("none");
  });
});

describe("sessionTokenFrom", () => {
  it("reads either Auth.js session cookie", () => {
    const jar = (name: string) => ({
      get: (n: string) => (n === name ? { value: "tok" } : undefined),
    });
    expect(sessionTokenFrom(jar("__Secure-authjs.session-token"))).toBe("tok");
    expect(sessionTokenFrom(jar("authjs.session-token"))).toBe("tok");
    expect(sessionTokenFrom(jar("other"))).toBeUndefined();
  });
});
