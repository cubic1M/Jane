import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/tax-identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tax-identity")>()),
  remindIpPin: vi.fn(async () => "2027-01-31"),
  markHavePin: vi.fn(),
  openCase: vi.fn(),
  markStep: vi.fn(async () => ({ complete: false })),
}));

import { IdentityError, markHavePin, markStep, openCase, remindIpPin } from "@/lib/tax-identity";
import { identityAction } from "./actions";

// Spec step 218: the IP PIN reminder, reporting a sign, and ticking off a step.

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("tax identity actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reminds, records the PIN, opens a case for a known sign, and ticks a step", async () => {
    expect(await identityAction(null, form({ intent: "remind" }))).toEqual({
      ok: true,
      message: "Getting your IP PIN is on your deadlines for 2027-01-31.",
    });
    expect(remindIpPin).toHaveBeenCalledWith("u1", { via: "page" });
    expect(await identityAction(null, form({ intent: "have" }))).toMatchObject({ ok: true });
    expect(markHavePin).toHaveBeenCalledWith("u1");
    expect(
      await identityAction(null, form({ intent: "open", sign: "unknown_form" })),
    ).toMatchObject({ ok: true });
    expect(openCase).toHaveBeenCalledWith("u1", "unknown_form", "told");
    expect(await identityAction(null, form({ intent: "step", step: "form_14039" }))).toEqual({
      ok: true,
      message: "Noted.",
    });
    expect(markStep).toHaveBeenCalledWith("u1", "form_14039");
  });

  it("refuses a sign it doesn't know, and says what's wrong", async () => {
    expect(await identityAction(null, form({ intent: "open", sign: "lost_wallet" }))).toMatchObject(
      { ok: false },
    );
    expect(openCase).not.toHaveBeenCalled();
    vi.mocked(openCase).mockRejectedValueOnce(
      new IdentityError("You already have a case open. Finish its steps first."),
    );
    expect(await identityAction(null, form({ intent: "open", sign: "irs_letter" }))).toEqual({
      ok: false,
      message: "You already have a case open. Finish its steps first.",
    });
    expect(await identityAction(null, form({ intent: "x" }))).toMatchObject({ ok: false });
  });
});
