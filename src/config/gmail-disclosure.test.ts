import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GMAIL_APP_VERIFIED, GMAIL_LIMITS } from "./gmail";
import { GMAIL_CONSENT, GMAIL_DISCLOSURE_VERSION, gmailDisclosure } from "./gmail-disclosure";

// What a person reads before connecting a mailbox is what they agreed to, and their mailbox row
// names it by version. So the words are pinned to the version: change a word and this fails until
// GMAIL_DISCLOSURE_VERSION has a new value with a line of its own here.

const shown = () => [...gmailDisclosure(), GMAIL_CONSENT];
const sha256 = (words: readonly string[]) =>
  createHash("sha256").update(words.join("\n")).digest("hex");

// Each version, and the SHA-256 of the words it stood for. A line is never changed or removed once
// people have agreed under it: new words get a new version and a new line.
const WORDS_OF: Record<string, string> = {
  "2026-11-18": "a2c55fcfdcce840e8e34c90cc39e53e392f222fb49bc564579a9ce70a7a6c33e",
};

const WARNING =
  "Google hasn't checked Jane yet, so its page shows a warning first. That's expected during the beta.";

// The bullets as they'd read with other settings in ./gmail.ts.
async function disclosureWith(settings: {
  verified?: boolean;
  lookBackDays?: number;
  lookBackMessages?: number;
}): Promise<readonly string[]> {
  const { verified = GMAIL_APP_VERIFIED, ...limits } = settings;
  vi.resetModules();
  vi.doMock("./gmail", async (original) => {
    const actual = await original<typeof import("./gmail")>();
    return {
      ...actual,
      GMAIL_APP_VERIFIED: verified,
      GMAIL_LIMITS: { ...actual.GMAIL_LIMITS, ...limits },
    };
  });
  return (await import("./gmail-disclosure")).gmailDisclosure();
}

afterEach(() => {
  vi.doUnmock("./gmail");
  vi.resetModules();
});

describe("what a person is told before connecting a mailbox", () => {
  it("is the words its version stands for: a changed word needs a new version", () => {
    expect(
      WORDS_OF[GMAIL_DISCLOSURE_VERSION],
      "The words changed, or the version did. People agreed to the old words under the old " +
        "version: give GMAIL_DISCLOSURE_VERSION a new value and add a line for it to WORDS_OF.",
    ).toBe(sha256(shown()));
  });

  it("takes how far back Jane reads from the limits, not from a number typed twice", async () => {
    expect(gmailDisclosure()).toContain(
      `Jane starts with your newest emails from the last ${GMAIL_LIMITS.lookBackDays} days, ` +
        `${GMAIL_LIMITS.lookBackMessages} at most, then reads new email until you disconnect.`,
    );
    expect(await disclosureWith({ lookBackDays: 3, lookBackMessages: 7 })).toContain(
      "Jane starts with your newest emails from the last 3 days, 7 at most, " +
        "then reads new email until you disconnect.",
    );
  });

  it("says Google's page will warn only while Google hasn't checked the app", async () => {
    const unchecked = await disclosureWith({ verified: false });
    const checked = await disclosureWith({ verified: true });
    expect(unchecked.at(-1)).toBe(WARNING);
    expect(checked).toEqual(unchecked.slice(0, -1));
    expect(gmailDisclosure()).toEqual(GMAIL_APP_VERIFIED ? checked : unchecked);
  });

  it("is whole sentences in plain words: none of ours for how it works", () => {
    for (const words of shown()) {
      expect(words, words).not.toMatch(/oauth|token|sync|webhook|scope/i);
      expect(words, words).not.toMatch(/[\u2013\u2014]/);
      expect(words.endsWith("."), words).toBe(true);
    }
  });

  it("says, whatever the version: read only, who reads it, what is kept and how it ends", () => {
    const all = gmailDisclosure().join(" ");
    expect(all).toMatch(/Jane can only read: it can't send, delete or change anything/);
    expect(all).toMatch(/Claude, the AI from Anthropic, reads each email that passes that check/);
    expect(all).toMatch(/It saves no text from the email/);
    expect(all).toMatch(/Jane deletes what it read from that mailbox and asks Google to end/);
    expect(GMAIL_CONSENT).toBe(
      "By connecting, you agree to Jane reading this mailbox as described above.",
    );
  });
});
