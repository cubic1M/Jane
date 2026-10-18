import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
  headers: vi.fn(async () => new Headers({ "user-agent": "Test Browser" })),
}));
vi.mock("@/lib/user-sessions", () => ({ noteSessionSeen: vi.fn(async () => {}) }));
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
vi.mock("next/server", () => ({
  connection: vi.fn(async () => {}),
  after: vi.fn((task: () => unknown) => task()),
}));

import { after, connection } from "next/server";
import { auth } from "@/auth";
import { TERMS_VERSION } from "@/config/legal";
import { adminSessionState } from "@/lib/admin-gate";
import { noteSessionSeen } from "@/lib/user-sessions";
import { getCurrentUser, getSessionState, requireAdmin, requireUser } from "./session";

const mockAuth = vi.mocked(auth as unknown as () => Promise<unknown>);

function signedInAs(role: "user" | "admin", mfaPending = false) {
  mockAuth.mockResolvedValue({
    user: { id: `${role}_1`, email: `${role}@example.com`, role, termsVersion: TERMS_VERSION },
    expires: "2099-01-01T00:00:00.000Z",
    mfaPending,
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

  // Spec step 73: the device and time are noted after the response, never blocking it.
  it("notes this session's device after the response", async () => {
    vi.mocked(noteSessionSeen).mockClear();
    vi.mocked(after).mockClear();
    signedInAs("user");

    await getSessionState();

    expect(after).toHaveBeenCalledOnce();
    expect(noteSessionSeen).toHaveBeenCalledWith("token", "Test Browser");
  });

  it("notes nothing when signed out", async () => {
    vi.mocked(noteSessionSeen).mockClear();
    mockAuth.mockResolvedValue(null);

    expect(await getSessionState()).toBeNull();
    expect(noteSessionSeen).not.toHaveBeenCalled();
  });

  it("treats a session that still owes a two-factor code as signed out", async () => {
    signedInAs("user", true);
    expect(await getCurrentUser()).toBeNull();
    expect(await getSessionState()).toMatchObject({ mfaPending: true, user: { id: "user_1" } });
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

  it("asks for the current Terms once before anything else", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user_1", role: "user", termsVersion: "2020-01-01" },
      expires: "2099-01-01T00:00:00.000Z",
    });

    await expect(requireUser()).rejects.toThrow("redirect:/terms/accept");
  });

  it("redirects to /login when signed out", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(requireUser()).rejects.toThrow("redirect:/login");
  });

  it("asks for the two-factor code before anything else", async () => {
    signedInAs("user", true);

    await expect(requireUser()).rejects.toThrow("redirect:/mfa");
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

  it("sends an admin whose session still owes a code to /mfa", async () => {
    signedInAs("admin", true);

    await expect(requireAdmin()).rejects.toThrow("redirect:/mfa");
  });

  it("answers 404 when signed out", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(requireAdmin()).rejects.toThrow("notFound");
  });
});
