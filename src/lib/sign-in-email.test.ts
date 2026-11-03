import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ hit: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendMagicLink: vi.fn() }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));

import { sendMagicLink } from "@/lib/email";
import { MagicLinkSendError } from "@/lib/magic-link-error";
import { hit } from "@/lib/rate-limit";
import { addressKey, sendSignInEmail } from "./sign-in-email";

const ok = { ok: true, remaining: 1, retryAfterSeconds: 0 };
const over = { ok: false, remaining: 0, retryAfterSeconds: 60 };
const URL = "https://jane.example/api/auth/callback/resend?token=abc";

describe("sendSignInEmail", () => {
  beforeEach(() => {
    vi.mocked(hit).mockReset().mockResolvedValue(ok);
    vi.mocked(sendMagicLink).mockReset().mockResolvedValue(undefined);
  });

  it("sends the link while the address is under its limits", async () => {
    await sendSignInEmail({ to: "a@b.com", url: URL });
    expect(sendMagicLink).toHaveBeenCalledWith({ to: "a@b.com", url: URL });
  });

  // Auth.js's own route skipped the form's limit per address: only the per-IP limit stood between
  // a script on many IPs and someone's inbox.
  it("sends nothing and says nothing once the address is over its limit for ten minutes", async () => {
    vi.mocked(hit).mockResolvedValueOnce(over);
    await expect(sendSignInEmail({ to: "a@b.com", url: URL })).resolves.toBeUndefined();
    expect(sendMagicLink).not.toHaveBeenCalled();
  });

  // A hard stop for the day would let anyone lock a person out with 20 requests, since anyone can ask
  // for anyone's link. One an hour means there's always a working link in their inbox.
  it("still sends one an hour past the day's limit, never none", async () => {
    vi.mocked(hit).mockImplementation(async (name) => (name === "signInEmailDay" ? over : ok));
    await sendSignInEmail({ to: "a@b.com", url: URL });
    expect(sendMagicLink).toHaveBeenCalledOnce();

    vi.mocked(sendMagicLink).mockClear();
    vi.mocked(hit).mockImplementation(async (name) =>
      name === "signInEmailDay" || name === "signInEmailPastDay" ? over : ok,
    );
    await sendSignInEmail({ to: "a@b.com", url: URL });
    expect(sendMagicLink).not.toHaveBeenCalled();
  });

  it("doesn't count toward the day what the ten-minute limit already stopped", async () => {
    vi.mocked(hit).mockResolvedValueOnce(over);
    await sendSignInEmail({ to: "a@b.com", url: URL });
    expect(vi.mocked(hit).mock.calls.map(([name]) => name)).toEqual(["signInEmail"]);
  });

  it("counts every spelling that reaches one inbox together, and never stores the address", async () => {
    for (const to of ["a@b.com", "A@B.com ", "a@b.com,1", "ａ@b.com"]) {
      await sendSignInEmail({ to, url: URL });
    }
    const subjects = vi.mocked(hit).mock.calls.map(([, subject]) => subject);
    expect(new Set(subjects).size).toBe(1);
    expect(subjects[0]).not.toContain("b.com");
  });

  it("says only that it failed when the send fails", async () => {
    vi.mocked(sendMagicLink).mockRejectedValue(new Error("refused for a@b.com"));
    await expect(sendSignInEmail({ to: "a@b.com", url: URL })).rejects.toBeInstanceOf(
      MagicLinkSendError,
    );
  });

  it("reduces an address to the one Auth.js sends to", () => {
    expect(addressKey(" Ada@Example.COM,x ")).toBe("ada@example.com");
  });
});
