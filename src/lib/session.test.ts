import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
}));

import { auth } from "@/auth";
import { requireAdmin, requireUser } from "./session";

const mockAuth = vi.mocked(auth as unknown as () => Promise<unknown>);

function signedInAs(role: "user" | "admin") {
  mockAuth.mockResolvedValue({
    user: { id: `${role}_1`, email: `${role}@example.com`, role },
    expires: "2099-01-01T00:00:00.000Z",
  });
}

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

  it("answers 404 when signed out", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(requireAdmin()).rejects.toThrow("notFound");
  });
});
