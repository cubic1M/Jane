import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => ({ value: "tok" }) })),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
}));
vi.mock("@/lib/session", () => ({ getSessionState: vi.fn(), HOME_PATH: "/home" }));
vi.mock("@/lib/mfa", () => ({ verifySessionCode: vi.fn() }));

import { verifySessionCode } from "@/lib/mfa";
import { getSessionState } from "@/lib/session";
import { submitCode } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const person = { user: { id: "u1", role: "user" as const }, mfaPending: true };

describe("submitCode", () => {
  it("checks the code for this session and continues", async () => {
    vi.mocked(getSessionState).mockResolvedValue(person as never);
    vi.mocked(verifySessionCode).mockResolvedValueOnce({ result: "ok" });
    await expect(submitCode(null, form({ code: "123456", next: "/budgets" }))).rejects.toThrow(
      "redirect:/budgets",
    );
    expect(verifySessionCode).toHaveBeenCalledWith("u1", "tok", "123456");
  });

  it("shows backup codes the first time instead of continuing", async () => {
    vi.mocked(getSessionState).mockResolvedValue(person as never);
    vi.mocked(verifySessionCode).mockResolvedValueOnce({ result: "ok", backupCodes: ["a-b"] });
    expect(await submitCode(null, form({ code: "123456", next: "//evil.example" }))).toEqual({
      backupCodes: ["a-b"],
      // Home is the hub (docs/design/home-hub.md).
      next: "/home",
    });
  });

  it("explains a wrong code, and needs a session", async () => {
    vi.mocked(getSessionState).mockResolvedValue(person as never);
    vi.mocked(verifySessionCode).mockResolvedValueOnce({ result: "wrong_code" });
    expect(await submitCode(null, form({ code: "000000" }))).toMatchObject({
      message: expect.stringContaining("didn't match"),
    });
    vi.mocked(getSessionState).mockResolvedValue(null);
    await expect(submitCode(null, form({ code: "1" }))).rejects.toThrow("notFound");
  });
});
