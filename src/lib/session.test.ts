import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("@/lib/admin-gate", () => ({
  adminSessionState: vi.fn(async () => "verified"),
  sessionTokenFrom: vi.fn(() => "token"),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
}));
vi.mock("next/server", () => ({ connection: vi.fn(async () => {}) }));

import { connection } from "next/server";
import { auth } from "@/auth";
import { adminSessionState } from "@/lib/admin-gate";
import { getCurrentUser, requireAdmin, requireUser } from "./session";

const mockAuth = vi.mocked(auth as unknown as () => Promise<unknown>);

function signedInAs(role: "user" | "admin") {
  mockAuth.mockResolvedValue({
    user: { id: `${role}_1`, email: `${role}@example.com`, role },
    expires: "2099-01-01T00:00:00.000Z",
  });
}

describe("getCurrentUser", () => {
  beforeEach(() => {
    mockAuth.mockReset();
  });

  // Auth.js uses crypto during the lookup, which Next.js rejects while prerendering.
  it("waits for the request before reading the session", async () => {
    const calls: string[] = [];
    vi.mocked(connection).mockImplementationOnce(async () => {
      calls.push("connection");
    });
    mockAuth.mockImplementationOnce(async () => {
      calls.push("auth");
      return null;
    });

    await getCurrentUser();

    expect(calls).toEqual(["connection", "auth"]);
  });
});

describe("requireUser", () => {
  beforeEach(() => {
    mockAuth.mockReset();
  });

  it("returns the signed-in user", async () => {
    signedInAs("user");

    await expect(requireUser()).resolves.toMatchObject({ id: "user_1", role: "user" });
  });

  it("redirects to /login when signed out", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(requireUser()).rejects.toThrow("redirect:/login");
  });
});

describe("requireAdmin", () => {
  beforeEach(() => {
    mockAuth.mockReset();
  });

  it("returns an admin", async () => {
    signedInAs("admin");

    await expect(requireAdmin()).resolves.toMatchObject({ id: "admin_1", role: "admin" });
  });

  it("answers 404 to a signed-in non-admin", async () => {
    signedInAs("user");

    await expect(requireAdmin()).rejects.toThrow("notFound");
  });

  it("sends an admin without a two-factor code in this session to /mfa", async () => {
    signedInAs("admin");
    vi.mocked(adminSessionState).mockResolvedValueOnce("needs_mfa");

    await expect(requireAdmin()).rejects.toThrow("redirect:/mfa");
  });

  it("answers 404 when signed out", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(requireAdmin()).rejects.toThrow("notFound");
  });
});
