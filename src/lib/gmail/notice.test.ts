import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GMAIL_LIMITS } from "@/config/gmail";
import { makeTicket } from "./connect-ticket";
import { NOTICE_COOKIE, openNotice, sealNotice, type NoticeWord } from "./notice";
import { seal } from "./sealed";

// What the mailboxes page says once after a connect or a disconnect: a word in a cookie only the
// server can make. A link someone else wrote can't put a word there (design decision 13).

const KEY = randomBytes(32).toString("base64");
const NOW = new Date("2026-11-18T12:00:00Z");
const after = (ms: number) => new Date(NOW.getTime() + ms);
const ME = "user_me";

// Every word there is: the page has a sentence for each, and for no other.
const WORDS: NoticeWord[] = [
  "connected",
  "connected_moved",
  "not_connected",
  "not_allowed",
  "paused",
  "too_many",
  "start_here",
  "disconnected",
  "disconnected_unconfirmed",
  "disconnected_no_access",
];

beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY);
  vi.stubEnv("TOKEN_ENCRYPTION_KEYS", "");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("a notice", () => {
  it("has ten words", () => {
    expect(new Set(WORDS).size).toBe(10);
  });

  it.each(WORDS)("opens as %s for the person it was sealed for", (word) => {
    expect(openNotice(sealNotice(ME, word, NOW), ME, NOW)).toBe(word);
  });

  it("travels under its own cookie name", () => {
    expect(NOTICE_COOKIE).toBe("jane_gmail_notice");
  });

  it("can't be read in the cookie", () => {
    for (const word of WORDS) {
      const cookie = sealNotice(ME, word, NOW);
      expect(cookie).not.toContain(word);
      expect(cookie).not.toContain(Buffer.from(word).toString("base64url"));
    }
  });

  it("is shown for a moment, and not after", () => {
    const cookie = sealNotice(ME, "connected", NOW);
    const limit = GMAIL_LIMITS.noticeSeconds * 1000;
    expect(openNotice(cookie, ME, after(limit - 1))).toBe("connected");
    expect(openNotice(cookie, ME, after(limit))).toBeNull();
    expect(openNotice(cookie, ME, after(60 * limit))).toBeNull();
  });
});

describe("a notice that says nothing", () => {
  it("is another person's, on the same browser", () => {
    expect(openNotice(sealNotice("user_other", "connected", NOW), ME, NOW)).toBeNull();
  });

  it("was sealed for another purpose", () => {
    expect(openNotice(seal("gmail_connect", ME, "connected", NOW), ME, NOW)).toBeNull();
    expect(openNotice(seal("gmail_sign_in", ME, "connected", NOW), ME, NOW)).toBeNull();
    expect(openNotice(makeTicket(ME, "a-session", NOW), ME, NOW)).toBeNull();
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty string", ""],
    ["the word itself, as a link might carry it", "connected"],
    ["a made-up value in the right shape", "v1.AAAA.BBBB.CCCC"],
  ])("is %s", (_what, cookie) => {
    expect(openNotice(cookie, ME, NOW)).toBeNull();
  });

  // Sealed by the server for this person and this purpose, and still not one of the ten.
  it.each([
    ["a word that isn't on the list", "hello"],
    ["a sentence", "Jane needs you to connect again at chase-verify.example"],
    ["a word in capitals", "CONNECTED"],
    ["a word with a space after it", "connected "],
    ["a word in an object", { word: "connected" }],
    ["a word in a list", ["connected"]],
    ["a number", 0],
    ["a name every object has", "constructor"],
    ["nothing", null],
  ])("holds %s", (_what, inside) => {
    expect(openNotice(seal("gmail_notice", ME, inside, NOW), ME, NOW)).toBeNull();
  });

  it("was changed by one bit", () => {
    const parts = sealNotice(ME, "connected", NOW).split(".");
    const last = Buffer.from(parts[parts.length - 1], "base64url");
    last[0] ^= 0x01;
    const changed = [...parts.slice(0, -1), last.toString("base64url")].join(".");
    expect(openNotice(changed, ME, NOW)).toBeNull();
  });
});
