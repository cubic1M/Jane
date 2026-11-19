import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GMAIL_LIMITS, GMAIL_PAGE_PATH } from "@/config/gmail";
import { form } from "@/lib/__fixtures__/form";
import { NOTICE_COOKIE, openNotice, type NoticeWord } from "@/lib/gmail/notice";

// Disconnect on /settings/mailboxes: it removes only the signed-in person's own mailbox, says what
// happened in a sealed cookie (never the address bar), and works with the switch off and while
// reading is paused. That another person's id finds nothing is removeMailbox's scoping
// (mailbox.integration.test.ts); here, that the action passes the signed-in person and leaves no
// word when nothing was removed.

const ME = "person_me";
const KEY = randomBytes(32).toString("base64");
const MAILBOX = "cmailboxone0000000000000";
const NOW = new Date("2026-11-19T18:00:00Z");

const mocks = vi.hoisted(() => ({ set: vi.fn(), removeMailbox: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.set }) }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "person_me" })) }));
vi.mock("@/lib/gmail/mailbox", () => ({ removeMailbox: mocks.removeMailbox }));

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { disconnectMailbox } from "./actions";

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.stubEnv("GMAIL_LINK", "1");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY);
  vi.stubEnv("TOKEN_ENCRYPTION_KEYS", "");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "");
  mocks.removeMailbox.mockResolvedValue({ endedAtGoogle: true, hadAccess: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// The word the cookie holds, as the page would read it.
function wordSet(): NoticeWord | null {
  expect(mocks.set).toHaveBeenCalledTimes(1);
  const [name, value, options] = mocks.set.mock.calls[0] as [string, string, object];
  expect(name).toBe(NOTICE_COOKIE);
  expect(options).toMatchObject({
    httpOnly: true,
    sameSite: "lax",
    path: GMAIL_PAGE_PATH,
    maxAge: GMAIL_LIMITS.noticeSeconds,
  });
  // Sealed at NOW: the page, a moment later, still reads it.
  return openNotice(value, ME, new Date(NOW.getTime() + 1_000));
}

describe("disconnecting a mailbox", () => {
  it("removes the signed-in person's own mailbox, and goes back to the page", async () => {
    await disconnectMailbox(form({ mailboxId: MAILBOX, userId: "someone_else" }));
    expect(mocks.removeMailbox).toHaveBeenCalledWith(ME, MAILBOX, "user_disconnected");
    expect(revalidatePath).toHaveBeenCalledWith(GMAIL_PAGE_PATH);
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
    expect(redirect).toHaveBeenCalledWith(GMAIL_PAGE_PATH);
  });

  it.each([
    [{ endedAtGoogle: true, hadAccess: true }, "disconnected"],
    [{ endedAtGoogle: false, hadAccess: true }, "disconnected_unconfirmed"],
    [{ endedAtGoogle: false, hadAccess: false }, "disconnected_no_access"],
  ] as const)("leaves the page the word for what happened: %o is %s", async (removed, word) => {
    mocks.removeMailbox.mockResolvedValue(removed);
    await disconnectMailbox(form({ mailboxId: MAILBOX }));
    expect(wordSet()).toBe(word);
  });

  it("leaves no word when nothing was removed: someone else's mailbox, or one already gone", async () => {
    mocks.removeMailbox.mockResolvedValue(null);
    await disconnectMailbox(form({ mailboxId: MAILBOX }));
    expect(mocks.removeMailbox).toHaveBeenCalledWith(ME, MAILBOX, "user_disconnected");
    expect(mocks.set).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(GMAIL_PAGE_PATH);
  });

  it.each([
    ["no id", form({})],
    ["an empty id", form({ mailboxId: "" })],
    ["a filter", form({ mailboxId: "' OR 1=1 --" })],
    ["a long one", form({ mailboxId: "c".repeat(41) })],
  ])("looks nothing up for %s", async (_name, data) => {
    await disconnectMailbox(data);
    expect(mocks.removeMailbox).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(GMAIL_PAGE_PATH);
  });

  it("looks nothing up for a file in place of an id", async () => {
    const data = new FormData();
    data.set("mailboxId", new Blob(["cmailbox"]), "mailbox.txt");
    await disconnectMailbox(data);
    expect(mocks.removeMailbox).not.toHaveBeenCalled();
  });

  it("works with the switch off and while reading is paused", async () => {
    vi.stubEnv("GMAIL_LINK", "");
    vi.stubEnv("KILL_BANKS", "1");
    await disconnectMailbox(form({ mailboxId: MAILBOX }));
    expect(mocks.removeMailbox).toHaveBeenCalledWith(ME, MAILBOX, "user_disconnected");
    expect(wordSet()).toBe("disconnected");
    const source = readFileSync("src/app/settings/mailboxes/actions.ts", "utf8");
    expect(source).not.toMatch(/gmailOffered|gmailOpen|killed\(/);
  });
});
