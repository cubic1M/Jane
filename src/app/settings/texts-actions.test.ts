import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/crypto", () => ({ decrypt: vi.fn(() => "+14155550142") }));
vi.mock("@/lib/db-scoped", () => ({
  scopedFor: vi.fn(() => ({
    textSettings: {
      findFirst: vi.fn(async () => ({ phoneEncrypted: "v1.x", verifiedAt: new Date() })),
    },
  })),
}));
vi.mock("@/lib/messaging/inbound", () => ({ handleInboundText: vi.fn(async () => "yes") }));
vi.mock("@/lib/messaging/texts", async () => {
  class TextError extends Error {}
  return {
    TextError,
    startVerification: vi.fn(async () => ({ phone: "(•••) •••-0142" })),
    confirmVerification: vi.fn(),
    saveTextPrefs: vi.fn(),
    removeTextNumber: vi.fn(),
  };
});

import { handleInboundText } from "@/lib/messaging/inbound";
import {
  TextError,
  confirmVerification,
  removeTextNumber,
  saveTextPrefs,
  startVerification,
} from "@/lib/messaging/texts";
import {
  confirmTextCode,
  forgetTextNumber,
  saveTextSettings,
  sendTextCode,
  simulateTextReply,
} from "./texts-actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("texts on /settings (spec step 78)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("sends a code to the signed-in person's number, only with consent ticked", async () => {
    expect(await sendTextCode(null, form({ phone: "415 555 0142", consent: "on" }))).toEqual({
      ok: true,
      message: "We texted a code to (•••) •••-0142. Enter it below.",
    });
    expect(startVerification).toHaveBeenCalledWith("u1", {
      phone: "415 555 0142",
      consent: true,
    });
    await sendTextCode(null, form({ phone: "415 555 0142" }));
    expect(startVerification).toHaveBeenLastCalledWith("u1", {
      phone: "415 555 0142",
      consent: false,
    });
  });

  it("shows the reason when something's wrong, and keeps the message", async () => {
    vi.mocked(confirmVerification).mockRejectedValueOnce(new TextError("That code expired."));
    expect(await confirmTextCode(null, form({ code: "123456" }))).toEqual({
      ok: false,
      message: "That code expired.",
    });
    expect(await confirmTextCode(null, form({ code: "123456" }))).toEqual({
      ok: true,
      message: "Your number is verified. Texts are on.",
    });
  });

  it("saves each kind of text, and turning texts off", async () => {
    expect(
      await saveTextSettings(null, form({ enabled: "on", alerts: "on", needsYou: "on" })),
    ).toEqual({ ok: true, message: "Saved." });
    expect(saveTextPrefs).toHaveBeenCalledWith("u1", {
      enabled: true,
      alerts: true,
      weeklyPlan: false,
      needsYou: true,
    });
    expect(await saveTextSettings(null, form({}))).toEqual({
      ok: true,
      message: "Saved. Jane won't text you.",
    });
  });

  it("removes the number", async () => {
    expect(await forgetTextNumber()).toMatchObject({ ok: true });
    expect(removeTextNumber).toHaveBeenCalledWith("u1");
  });

  it("answers from the simulated phone only when texts are simulated", async () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(await simulateTextReply(null, form({ content: "YES" }))).toMatchObject({ ok: true });
    expect(handleInboundText).toHaveBeenCalledWith(
      expect.objectContaining({ content: "YES", number: "+14155550142", is_outbound: false }),
    );

    vi.mocked(handleInboundText).mockClear();
    vi.stubEnv("NODE_ENV", "production");
    expect(await simulateTextReply(null, form({ content: "YES" }))).toEqual({
      ok: false,
      message: "Not available.",
    });
    expect(handleInboundText).not.toHaveBeenCalled();
  });
});
