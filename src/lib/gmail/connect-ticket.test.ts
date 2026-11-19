import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GMAIL_LIMITS } from "@/config/gmail";
import { GMAIL_DISCLOSURE_VERSION } from "@/config/gmail-disclosure";
import { decrypt } from "@/lib/crypto";
import { makeTicket, ticketHolds } from "./connect-ticket";
import { sealNotice } from "./notice";
import { seal } from "./sealed";

// The ticket in the Connect link: only the mailboxes page can make one, for the person looking at it
// and the session of the browser they are in. A link someone else wrote has none, so it can't lead
// a person into Google's consent for the sender's account (critique-security S3).

const KEY = randomBytes(32).toString("base64");
const NOW = new Date("2026-11-18T12:00:00Z");
const MINUTE = 60_000;
const after = (ms: number) => new Date(NOW.getTime() + ms);

const ME = "user_me";
// Made here, so nothing token-shaped sits in the source.
const session = () => `session-${randomUUID()}`;
const hashOf = (token: string) => createHash("sha256").update(token).digest("base64url");

beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY);
  vi.stubEnv("TOKEN_ENCRYPTION_KEYS", "");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("a ticket from the mailboxes page", () => {
  it("holds for the person and the session it was made for, and says which words they saw", () => {
    const sessionToken = session();
    const ticket = makeTicket(ME, sessionToken, NOW);
    expect(ticketHolds(ticket, { userId: ME, sessionToken, now: NOW })).toEqual({
      disclosure: GMAIL_DISCLOSURE_VERSION,
    });
  });

  it("holds for as long as a page may stay open, and not after", () => {
    const sessionToken = session();
    const ticket = makeTicket(ME, sessionToken, NOW);
    const limit = GMAIL_LIMITS.ticketMinutes * MINUTE;
    expect(ticketHolds(ticket, { userId: ME, sessionToken, now: after(limit - 1) })).not.toBeNull();
    expect(ticketHolds(ticket, { userId: ME, sessionToken, now: after(limit) })).toBeNull();
    expect(
      ticketHolds(ticket, { userId: ME, sessionToken, now: after(24 * 60 * MINUTE) }),
    ).toBeNull();
  });

  it("can be used more than once while it is fresh: a second click on the link works", () => {
    const sessionToken = session();
    const ticket = makeTicket(ME, sessionToken, NOW);
    const check = { userId: ME, sessionToken, now: after(MINUTE) };
    expect(ticketHolds(ticket, check)).not.toBeNull();
    expect(ticketHolds(ticket, check)).not.toBeNull();
  });

  it("goes in an address as it is", () => {
    const ticket = makeTicket(ME, session(), NOW);
    expect(encodeURIComponent(ticket)).toBe(ticket);
    expect(
      new URL(`https://jane.test/api/gmail/connect?ticket=${ticket}`).searchParams.get("ticket"),
    ).toBe(ticket);
  });
});

describe("a ticket that doesn't hold", () => {
  it("is another person's", () => {
    const sessionToken = session();
    const theirs = makeTicket("user_other", sessionToken, NOW);
    expect(ticketHolds(theirs, { userId: ME, sessionToken, now: NOW })).toBeNull();
  });

  it("is from another session, even this person's own", () => {
    const ticket = makeTicket(ME, session(), NOW);
    expect(ticketHolds(ticket, { userId: ME, sessionToken: session(), now: NOW })).toBeNull();
  });

  it("is from a session whose token differs by one character", () => {
    const sessionToken = session();
    const ticket = makeTicket(ME, sessionToken, NOW);
    const close = `${sessionToken.slice(0, -1)}${sessionToken.endsWith("0") ? "1" : "0"}`;
    expect(ticketHolds(ticket, { userId: ME, sessionToken: close, now: NOW })).toBeNull();
    expect(
      ticketHolds(ticket, { userId: ME, sessionToken: `${sessionToken} `, now: NOW }),
    ).toBeNull();
  });

  it("is checked in a browser with no session", () => {
    const ticket = makeTicket(ME, session(), NOW);
    expect(ticketHolds(ticket, { userId: ME, sessionToken: undefined, now: NOW })).toBeNull();
    expect(ticketHolds(ticket, { userId: ME, sessionToken: "", now: NOW })).toBeNull();
    // A ticket made for no session doesn't hold for one either.
    const none = makeTicket(ME, "", NOW);
    expect(ticketHolds(none, { userId: ME, sessionToken: "", now: NOW })).toBeNull();
  });

  it("is old", () => {
    const sessionToken = session();
    const old = makeTicket(ME, sessionToken, after(-GMAIL_LIMITS.ticketMinutes * MINUTE));
    expect(ticketHolds(old, { userId: ME, sessionToken, now: NOW })).toBeNull();
  });

  it("was sealed for another purpose", () => {
    const sessionToken = session();
    const inside = { session: hashOf(sessionToken), disclosure: GMAIL_DISCLOSURE_VERSION };
    const check = { userId: ME, sessionToken, now: NOW };
    // The same contents, sealed as a ticket, do hold: only the purpose differs below.
    expect(ticketHolds(seal("gmail_connect", ME, inside, NOW), check)).not.toBeNull();
    expect(ticketHolds(seal("gmail_notice", ME, inside, NOW), check)).toBeNull();
    expect(ticketHolds(seal("gmail_sign_in", ME, inside, NOW), check)).toBeNull();
    expect(ticketHolds(sealNotice(ME, "connected", NOW), check)).toBeNull();
  });

  it("was made under words that have since changed", () => {
    const sessionToken = session();
    const earlier = { session: hashOf(sessionToken), disclosure: "2020-01-01" };
    const ticket = seal("gmail_connect", ME, earlier, NOW);
    expect(ticketHolds(ticket, { userId: ME, sessionToken, now: NOW })).toBeNull();
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty string", ""],
    ["a word", "ticket"],
    ["the word a link might carry", "1"],
    ["a made-up value in the right shape", "v1.AAAA.BBBB.CCCC"],
    ["a session token itself", "session-00000000-0000-0000-0000-000000000000"],
  ])("is %s", (_what, ticket) => {
    expect(ticketHolds(ticket, { userId: ME, sessionToken: session(), now: NOW })).toBeNull();
  });

  it("was changed by one bit", () => {
    const sessionToken = session();
    const parts = makeTicket(ME, sessionToken, NOW).split(".");
    const last = Buffer.from(parts[parts.length - 1], "base64url");
    last[0] ^= 0x01;
    const changed = [...parts.slice(0, -1), last.toString("base64url")].join(".");
    expect(ticketHolds(changed, { userId: ME, sessionToken, now: NOW })).toBeNull();
  });

  it.each([
    ["no session inside", { disclosure: GMAIL_DISCLOSURE_VERSION }],
    ["no words inside", { session: "x" }],
    ["a session that isn't text", { session: 5, disclosure: GMAIL_DISCLOSURE_VERSION }],
    ["a session hash cut short", { session: "abc", disclosure: GMAIL_DISCLOSURE_VERSION }],
    ["an empty session hash", { session: "", disclosure: GMAIL_DISCLOSURE_VERSION }],
    ["only a word", "connected"],
    ["a list", ["x", GMAIL_DISCLOSURE_VERSION]],
    ["nothing inside", null],
  ])("holds %s, though sealed as a ticket for this person", (_what, inside) => {
    const ticket = seal("gmail_connect", ME, inside, NOW);
    expect(ticketHolds(ticket, { userId: ME, sessionToken: session(), now: NOW })).toBeNull();
  });
});

describe("the session token", () => {
  it("is never in a ticket, sealed or opened: only its hash is", () => {
    const sessionToken = session();
    const ticket = makeTicket(ME, sessionToken, NOW);
    expect(ticket).not.toContain(sessionToken);
    const inside = decrypt(ticket);
    expect(inside).not.toContain(sessionToken);
    expect(JSON.parse(inside)).toEqual({
      for: "gmail_connect",
      userId: ME,
      at: NOW.getTime(),
      data: { session: hashOf(sessionToken), disclosure: GMAIL_DISCLOSURE_VERSION },
    });
  });

  it("is compared in a way that takes the same time whichever byte differs, and is never logged", () => {
    const source = readFileSync(join(__dirname, "connect-ticket.ts"), "utf8");
    expect(source).toMatch(/timingSafeEqual\(sealed, mine\)/);
    expect(source).not.toMatch(/\blog\.|console\.|===\s*hashOf|hashOf\([^)]*\)\s*===/);
  });
});
