import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", email: "alex@example.com" })),
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock("@/lib/shared-bills", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/shared-bills")>()),
  splitCharge: vi.fn(),
  unsplitCharge: vi.fn(),
  settleUp: vi.fn(),
}));
vi.mock("@/lib/household", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/household")>()),
  invitePartner: vi.fn(async () => ({ token: "tok" })),
  acceptInvite: vi.fn(),
  leaveHousehold: vi.fn(),
  setAccountSharing: vi.fn(),
}));

import { sendEmail } from "@/lib/email";
import {
  HouseholdError,
  acceptInvite,
  invitePartner,
  leaveHousehold,
  setAccountSharing,
} from "@/lib/household";
import { SharedBillError, settleUp, splitCharge, unsplitCharge } from "@/lib/shared-bills";
import { invite, join, leave, settle, share, split, unsplit } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("household actions", () => {
  beforeEach(() => {
    vi.stubEnv("APP_URL", "https://app.example.com");
    vi.mocked(sendEmail).mockClear();
  });

  it("invites for the signed-in person and shows the link", async () => {
    const state = await invite(null, form({ email: "blair@example.com" }));
    expect(invitePartner).toHaveBeenCalledWith(
      { id: "u1", email: "alex@example.com" },
      "blair@example.com",
    );
    expect(state).toMatchObject({
      ok: true,
      link: "https://app.example.com/household/join?token=tok",
    });
  });

  it("emails the invite only when email is set up", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    await invite(null, form({ email: "blair@example.com" }));
    expect(sendEmail).not.toHaveBeenCalled();
    vi.stubEnv("RESEND_API_KEY", "key");
    await invite(null, form({ email: "blair@example.com" }));
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "blair@example.com" }));
  });

  it("shows household errors as messages", async () => {
    vi.mocked(invitePartner).mockRejectedValueOnce(new HouseholdError("Your household is full."));
    expect(await invite(null, form({ email: "x@example.com" }))).toEqual({
      ok: false,
      message: "Your household is full.",
    });
    vi.mocked(acceptInvite).mockRejectedValueOnce(new HouseholdError("expired"));
    expect(await join(null, form({ token: "t" }))).toEqual({ ok: false, message: "expired" });
  });

  it("joins, shares and leaves for the signed-in person only", async () => {
    await expect(join(null, form({ token: "t" }))).rejects.toThrow("redirect:/household");
    expect(acceptInvite).toHaveBeenCalledWith({ id: "u1", email: "alex@example.com" }, "t");

    await share(form({ accountId: "a1", shared: "true" }));
    expect(setAccountSharing).toHaveBeenCalledWith("u1", "a1", true);

    await leave();
    expect(leaveHousehold).toHaveBeenCalledWith("u1");
  });

  it("splits, unsplits and settles for the signed-in person only", async () => {
    await split(form({ transactionId: "t1" }));
    expect(splitCharge).toHaveBeenLastCalledWith("u1", "t1", 5_000);
    await split(form({ transactionId: "t1", percent: "30" }));
    expect(splitCharge).toHaveBeenLastCalledWith("u1", "t1", 3_000);

    await unsplit(form({ sharedChargeId: "s1" }));
    expect(unsplitCharge).toHaveBeenCalledWith("u1", "s1");

    await settle();
    expect(settleUp).toHaveBeenCalledWith("u1");
  });

  it("ignores a split that isn't allowed, but not other errors", async () => {
    vi.mocked(splitCharge).mockRejectedValueOnce(new SharedBillError("no"));
    await expect(split(form({ transactionId: "t1" }))).resolves.toBeUndefined();
    vi.mocked(splitCharge).mockRejectedValueOnce(new Error("db down"));
    await expect(split(form({ transactionId: "t1" }))).rejects.toThrow("db down");
  });
});
