import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/admin-access", () => ({ logAdminAccess: vi.fn() }));
vi.mock("@/lib/admin-gate", () => ({ adminSession: vi.fn(), sessionTokenFrom: () => undefined }));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  hitMany: async () => ({ ok: false, remaining: 0, retryAfterSeconds: 120 }),
}));

import { NextRequest, type NextFetchEvent } from "next/server";
import { proxy } from "@/proxy";
import { authErrorMessage } from "./auth-errors";

// A sign-in link from the email, or Google's way back, is a page the person opened. Past the
// callback limit (a dorm on one address on invite day) they saw `{"error":"Too many requests…"}`
// in their browser with no way onward (debug 3, 11-16).
describe("a sign-in link past the limit", () => {
  it.each([
    "/api/auth/callback/resend?token=abc&email=a%40b.test",
    "/api/auth/callback/google?code=abc&state=xyz",
  ])("%s goes to the sign-in page, which says why", async (path) => {
    const request = new NextRequest(`https://jane.test${path}`, {
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    const response = await proxy(request, { waitUntil: () => {} } as unknown as NextFetchEvent);
    expect(response?.status).toBe(303);
    expect(response?.headers.get("Retry-After")).toBe("120");
    // Whole: Next.js refuses a relative address from the proxy ("Invalid URL", a 500).
    const to = new URL(response?.headers.get("Location") ?? "");
    expect(to.origin).toBe("https://jane.test");
    expect(to.pathname).toBe("/login");
    expect(authErrorMessage(to.searchParams.get("error") ?? undefined)).toBe(
      "Too many sign-in attempts. Wait a few minutes and try again.",
    );
  });
});
