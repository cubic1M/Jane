import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { launchChecks, launchReady } from "./launch-check";

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
