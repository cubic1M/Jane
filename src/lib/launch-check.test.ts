import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { launchChecks, launchReady, signInEmailCheck } from "./launch-check";

const READY = {
  DATABASE_URL: "postgresql://u:p@db.example.neon.tech/neondb",
  DIRECT_URL: "postgresql://u:p@db.example.neon.tech/neondb",
  AUTH_SECRET: "x".repeat(44),
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  RESEND_API_KEY: "re_live",
  EMAIL_FROM: "Team <hi@example.com>",
  APP_URL: "https://app.example.com",
  CRON_SECRET: "c".repeat(64),
  PLAID_ENV: "production",
  PLAID_CLIENT_ID: "id",
  PLAID_SECRET: "secret",
  ADMIN_EMAILS: "team@example.com",
};

const failing = (env: Record<string, string | undefined>) =>
  launchChecks(env)
    .filter((c) => !c.ok && c.required)
    .map((c) => c.name);

describe("launchChecks", () => {
  it("passes a complete production setup", () => {
    expect(failing(READY)).toEqual([]);
    expect(launchReady(launchChecks(READY))).toBe(true);
  });

  it("fails on Plaid Sandbox, a local database or a short key", () => {
    expect(failing({ ...READY, PLAID_ENV: "sandbox" })).toEqual(["Plaid environment"]);
    expect(failing({ ...READY, DATABASE_URL: "postgresql://localhost:5432/x" })).toEqual([
      "Database",
    ]);
    expect(failing({ ...READY, TOKEN_ENCRYPTION_KEY: "short" })).toEqual(["Token encryption key"]);
    expect(failing({ ...READY, BETA_INVITE_ONLY: "false" })).toEqual(["Closed beta"]);
  });

  // Resend's test sender only reaches the address that owns the Resend account, so every other
  // sign-in link is refused while the settings all look right (production logs, 11-02).
  it("fails on Resend's test sender, however it is written", () => {
    for (const from of [
      "onboarding@resend.dev",
      "Jane <onboarding@resend.dev>",
      "Jane <ONBOARDING@RESEND.DEV>",
    ]) {
      expect(failing({ ...READY, EMAIL_FROM: from })).toEqual(["Email sender"]);
    }
    const sender = launchChecks({ ...READY, EMAIL_FROM: "onboarding@resend.dev" }).find(
      (c) => c.name === "Email sender",
    );
    expect(sender?.detail).toMatch(/verify a domain/i);
  });

  it("doesn't mistake a real domain for the test sender", () => {
    for (const from of ["Jane <hi@notresend.dev>", "resend.dev <hi@example.com>"]) {
      expect(failing({ ...READY, EMAIL_FROM: from })).toEqual([]);
    }
  });

  it("leaves a missing sender to the Email check", () => {
    expect(failing({ ...READY, EMAIL_FROM: "" })).toEqual(["Email"]);
  });

  it("checks the current key of a rotated keyring (docs/security/keys.md)", () => {
    const keys = `k2:${randomBytes(32).toString("base64")},k3:${randomBytes(32).toString("base64")}`;
    const rotated = { ...READY, TOKEN_ENCRYPTION_KEY: "", TOKEN_ENCRYPTION_KEYS: keys };
    expect(failing({ ...rotated, TOKEN_ENCRYPTION_KEY_CURRENT: "k3" })).toEqual([]);
    expect(failing({ ...rotated, TOKEN_ENCRYPTION_KEY_CURRENT: "k4" })).toEqual([
      "Token encryption key",
    ]);
    expect(
      failing({
        ...rotated,
        TOKEN_ENCRYPTION_KEYS: "k3:short",
        TOKEN_ENCRYPTION_KEY_CURRENT: "k3",
      }),
    ).toEqual(["Token encryption key"]);
    expect(failing(rotated)).toEqual(["Token encryption key"]);
  });

  it("treats Stripe as optional, but a test key as wrong once set", () => {
    const stripe = (env: Record<string, string>) =>
      launchChecks({ ...READY, ...env }).find((c) => c.name === "Stripe");
    expect(stripe({})).toMatchObject({ ok: true, required: false });
    expect(stripe({ STRIPE_SECRET_KEY: "sk_test_1", STRIPE_WEBHOOK_SECRET: "whsec_1" })?.ok).toBe(
      false,
    );
    expect(stripe({ STRIPE_SECRET_KEY: "sk_live_1", STRIPE_WEBHOOK_SECRET: "whsec_1" })?.ok).toBe(
      true,
    );
    expect(launchReady(launchChecks({ ...READY, STRIPE_SECRET_KEY: "sk_test_1" }))).toBe(true);
  });

  it("shows the bank connections used, and being full never blocks launch", () => {
    const line = (env: Record<string, string>, used?: number) =>
      launchChecks({ ...READY, ...env }, used === undefined ? undefined : { used, limit: 10 }).find(
        (c) => c.name === "Bank connections",
      );
    expect(line({}, 3)).toMatchObject({
      ok: true,
      required: false,
      detail: "3 of 10 bank connections used",
    });
    expect(line({}, 10)).toMatchObject({ ok: false, required: false });
    expect(line({})).toMatchObject({ ok: true, detail: expect.stringContaining("/admin/launch") });
    expect(line({ PLAID_TRIAL_ITEM_LIMIT: "lots" })).toMatchObject({
      ok: false,
      detail: expect.stringContaining("whole numbers"),
    });
    expect(line({ PLAID_ITEMS_PER_PERSON: "-1" })?.ok).toBe(false);
    expect(line({ PLAID_TRIAL_ITEM_LIMIT: "200", PLAID_ITEMS_PER_PERSON: "3" })?.ok).toBe(true);
    expect(failing({ ...READY, PLAID_TRIAL_ITEM_LIMIT: "lots" })).toEqual([]);
  });

  it("never includes a value in its output", () => {
    const output = JSON.stringify(launchChecks(READY));
    const secrets = [
      READY.DATABASE_URL,
      READY.AUTH_SECRET,
      READY.TOKEN_ENCRYPTION_KEY,
      READY.CRON_SECRET,
      READY.ADMIN_EMAILS,
    ];
    for (const value of secrets) expect(output).not.toContain(value);
  });
});

// Founder's admin sign-in, 11-02: the settings were there and every check passed while Resend
// refused the mail.
describe("sign-in emails that failed", () => {
  it("passes with none in the last day", () => {
    expect(signInEmailCheck(0)).toMatchObject({ name: "Sign-in emails", ok: true, required: true });
  });

  it("fails, saying how many and where to look", () => {
    const check = signInEmailCheck(3);
    expect(check.ok).toBe(false);
    expect(check.detail).toBe(
      "3 sign-in emails failed to send in the last day. The reason is on the server log, after [magic-link].",
    );
    expect(signInEmailCheck(1).detail).toMatch(/^1 sign-in email failed/);
    expect(launchReady([signInEmailCheck(1)])).toBe(false);
  });
});
