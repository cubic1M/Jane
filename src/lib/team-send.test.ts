import { describe, expect, it, vi } from "vitest";
import { TRIAL_ID_PREFIX } from "@/config/trial";
import { sendToAny } from "./team-send";

const message = { subject: "s", text: "t", html: "<p>t</p>" };
const trial = `${TRIAL_ID_PREFIX}x@try.jane.invalid`;

describe("sendToAny", () => {
  it("counts the addresses that took it, and only throws when none did", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn(async ({ to }: { to: string }) => {
      if (to === "a@example.test") throw new Error("bounced");
      return { id: null };
    });
    expect(await sendToAny(["a@example.test", "b@example.test"], message, send)).toBe(1);

    send.mockRejectedValue(new Error("down"));
    await expect(sendToAny(["a@example.test", "b@example.test"], message, send)).rejects.toThrow(
      "down",
    );
  });

  it("never counts a sample person's address as a delivery, nor mails it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn(async ({ to }: { to: string }) => {
      if (to === "real@example.test") throw new Error("down");
    });
    await expect(sendToAny([trial, "real@example.test"], message, send)).rejects.toThrow("down");
    expect(send.mock.calls.map(([m]) => m.to)).toEqual(["real@example.test"]);
  });
});
