import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GMAIL_APP_VERIFIED, GMAIL_LIMITS, PERSONAL_MAIL_DOMAINS } from "./gmail";
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
  // Only the free services Jane knows are said to be skipped as personal; a reading keeps the
  // sender's domain and Gmail's id, not an address.
  "2026-11-19": "9559f47a55d641f1c245ee95362bcfa0e8603aba47c0e5dfe724f182299a1fd0",
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

  it("promises to skip only the free email services Jane knows, and knows each one it names", () => {
    const all = gmailDisclosure().join(" ");
    expect(all).toMatch(
      /only when it looks like it's about money and doesn't come from a free email service Jane knows, like gmail\.com, outlook\.com or icloud\.com\./,
    );
    // No list knows every service, and a person's own domain can't be told from a company's, so no
    // word says either is skipped.
    expect(all).not.toMatch(/personal address|comes from a company|large free/);
    expect(all).toMatch(
      /An email someone sends from their own domain, or from a service Jane doesn't know, can't be told from a company's, so it can be read too\./,
    );
    // Every service the words name as known is one the screen skips.
    const like = /a free email service Jane knows, like (.+?)\. /.exec(all)?.[1] ?? "";
    const named = like.match(/[a-z0-9-]+(?:\.[a-z]+)+/g) ?? [];
    expect(named).toEqual(["gmail.com", "outlook.com", "icloud.com"]);
    for (const domain of named) expect(PERSONAL_MAIL_DOMAINS.has(domain), domain).toBe(true);
  });

  it("says a reading keeps the domain an email came from and Gmail's id, as the table does", () => {
    const all = gmailDisclosure().join(" ");
    expect(all).toMatch(
      /Jane saves those, with the domain the email came from \(like amazon\.com\), when it arrived and Gmail's id for it\./,
    );
    expect(all).not.toMatch(/the address the email came from/);
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const model = schema.slice(schema.indexOf("model GmailReading {")).split("\n}")[0];
    const columns = [...model.matchAll(/^ {2}(\w+)\s/gm)].map((m) => m[1]);
    expect(columns).toEqual(expect.arrayContaining(["senderDomain", "receivedAt", "messageRef"]));
    expect(columns.filter((column) => /address|from/i.test(column))).toEqual([]);
  });
});
