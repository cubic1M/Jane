import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", email: "alex@example.com", role: "user" })),
}));
vi.mock("@/lib/mfa", () => ({ turnOffTwoFactor: vi.fn(), newBackupCodes: vi.fn() }));

import { newBackupCodes, turnOffTwoFactor } from "@/lib/mfa";
import { makeBackupCodes, turnOff } from "./two-factor-actions";

const form = (code: string) => {
  const data = new FormData();
  data.set("code", code);
  return data;
};

describe("two-factor settings actions", () => {
  it("turns it off for the signed-in person with their code", async () => {
    vi.mocked(turnOffTwoFactor).mockResolvedValueOnce("ok");
    expect(await turnOff(null, form("123456"))).toEqual({
      ok: true,
      message: "Two-factor is off.",
    });
    expect(turnOffTwoFactor).toHaveBeenCalledWith("u1", "123456");

    vi.mocked(turnOffTwoFactor).mockResolvedValueOnce("admin");
    expect(await turnOff(null, form("123456"))).toMatchObject({ ok: false });
  });

  it("shows new backup codes once made", async () => {
    vi.mocked(newBackupCodes).mockResolvedValueOnce({ result: "ok", codes: ["aaaaa-bbbbb"] });
    expect(await makeBackupCodes(null, form("123456"))).toMatchObject({
      ok: true,
      codes: ["aaaaa-bbbbb"],
    });
    vi.mocked(newBackupCodes).mockResolvedValueOnce({ result: "wrong_code" });
    expect(await makeBackupCodes(null, form("000000"))).toMatchObject({ ok: false });
  });
});
