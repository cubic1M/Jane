import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === "authjs.session-token" ? { value: "this-token" } : undefined),
  })),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/user-sessions", () => ({
  signOutSession: vi.fn(async () => "ok"),
  signOutOtherSessions: vi.fn(async () => 2),
}));

import { requireUser } from "@/lib/session";
import { signOutOtherSessions, signOutSession } from "@/lib/user-sessions";
import { signOutDevice, signOutOthers } from "./session-actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("session sign-out actions (spec step 73)", () => {
  beforeEach(() => {
    vi.mocked(signOutSession).mockClear();
    vi.mocked(signOutOtherSessions).mockClear();
  });

  it("signs out one session by its id, for the signed-in person, keeping this cookie", async () => {
    expect(await signOutDevice(null, form({ sessionId: "s2" }))).toEqual({
      ok: true,
      message: "Signed out of that device.",
    });
    expect(signOutSession).toHaveBeenCalledWith("u1", "s2", "this-token");
  });

  it("says so when the session is gone or isn't theirs", async () => {
    vi.mocked(signOutSession).mockResolvedValueOnce("not_found");
    expect(await signOutDevice(null, form({ sessionId: "someone-elses" }))).toMatchObject({
      ok: false,
    });
  });

  it("signs out every other device and says how many", async () => {
    expect(await signOutOthers()).toEqual({
      ok: true,
      message: "Signed out of 2 other devices.",
    });
    expect(signOutOtherSessions).toHaveBeenCalledWith("u1", "this-token");

    vi.mocked(signOutOtherSessions).mockResolvedValueOnce(1);
    expect((await signOutOthers())?.message).toBe("Signed out of 1 other device.");
    vi.mocked(signOutOtherSessions).mockResolvedValueOnce(0);
    expect((await signOutOthers())?.message).toBe("You're not signed in anywhere else.");
  });

  it("needs a signed-in person", async () => {
    vi.mocked(requireUser).mockRejectedValueOnce(new Error("redirect:/login"));
    await expect(signOutOthers()).rejects.toThrow("redirect:/login");
    expect(signOutOtherSessions).not.toHaveBeenCalled();
  });
});
