import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appBase } from "./digest/links";
import { webhookUrl } from "./plaid/client";
import { verifyResendSignature } from "./digest/resend-webhook";

// Security audit: what a setting left unset or empty does on a deployed site.
describe("links, with APP_URL unset or empty on Vercel", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([[undefined], [""]])("emails and Plaid go to the production domain: %j", (value) => {
    if (value === undefined) delete process.env.APP_URL;
    else vi.stubEnv("APP_URL", value);
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "jane.example");
    expect(appBase()).toBe("https://jane.example");
    expect(webhookUrl()).toBe("https://jane.example/api/plaid/webhook");
  });

  it("keeps a custom domain, without a trailing slash", () => {
    vi.stubEnv("APP_URL", "https://custom.example/");
    expect(appBase()).toBe("https://custom.example");
  });
});

describe("a webhook secret with nothing in it", () => {
  it("signs nothing: anyone could make a signature with an empty key", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    const timestamp = String(now.getTime() / 1000);
    const signed = createHmac("sha256", Buffer.alloc(0)).update(`id.${timestamp}.{}`).digest();
    const headers = new Headers({
      "svix-id": "id",
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signed.toString("base64")}`,
    });
    expect(verifyResendSignature("{}", headers, "whsec_", now)).toBe(false);
  });
});
