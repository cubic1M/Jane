import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/lib/crypto";
import { openSignIn } from "./oauth-pkce";

// A cookie that decrypts isn't always a sign-in: anything the app seals with the same key opens too.
// Each of these is "not their sign-in" (null), never a thrown error, so the way back from Robinhood
// sends the person on rather than answering 500 (src/app/api/robinhood/callback/route.ts).

const USER = "person-1";
const STATE = "the-state";
const STARTED = 1_000_000;

const sealed = (value: unknown) => encrypt(JSON.stringify(value));
const open = (cookie: string) =>
  openSignIn(cookie, { userId: USER, state: STATE, maxAgeMs: 60_000, now: STARTED + 1 });

describe("opening a sign-in's cookie that holds something else", () => {
  beforeEach(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64"));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("still opens a sign-in for this person, so the rest can't pass by refusing everything", () => {
    expect(open(sealed({ state: STATE, userId: USER, at: STARTED }))).toEqual({
      state: STATE,
      userId: USER,
      at: STARTED,
    });
  });

  it("is null for a sealed null", () => {
    expect(open(sealed(null))).toBeNull();
  });

  it("is null for a sealed array", () => {
    expect(open(sealed([STATE, USER, STARTED]))).toBeNull();
  });

  it("is null for a sealed object with no state", () => {
    expect(open(sealed({ userId: USER, at: STARTED }))).toBeNull();
  });

  it("is null for a sealed object whose state is a number", () => {
    expect(open(sealed({ state: 42, userId: USER, at: STARTED }))).toBeNull();
  });

  it("is null when its time isn't a finite number", () => {
    expect(open(sealed({ state: STATE, userId: USER, at: String(STARTED) }))).toBeNull();
    // JSON reads 1e999 as Infinity, which would otherwise count as fresh forever.
    expect(open(encrypt(`{"state":"${STATE}","userId":"${USER}","at":1e999}`))).toBeNull();
  });
});
