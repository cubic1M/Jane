// The production switch checklist (spec step 11): checks the environment before outside
// users arrive. Reports pass or fail only, never a value. Run it with
// `npm run check:launch` or open /admin/launch on the deployed site.
// No imports, so Node can run it directly from scripts/launch-check.ts.

export type Check = { name: string; ok: boolean; required: boolean; detail: string };

type Env = Record<string, string | undefined>;

const isSet = (v: string | undefined) => typeof v === "string" && v.trim().length > 0;

function base64Bytes(value: string | undefined): number {
  try {
    return value ? Buffer.from(value, "base64").length : 0;
  } catch {
    return 0;
  }
}

function hostOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}

export function launchChecks(env: Env): Check[] {
  const appUrl =
    env.APP_URL ??
    (env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined);
  const dbHost = hostOf(env.DATABASE_URL);
  const stripeKey = env.STRIPE_SECRET_KEY;
  const check = (name: string, ok: boolean, detail: string, required = true): Check => ({
    name,
    ok,
    required,
    detail,
  });

  return [
    check(
      "Database",
      isSet(env.DATABASE_URL) && dbHost !== null && !["localhost", "127.0.0.1"].includes(dbHost),
      "DATABASE_URL points at a hosted database",
    ),
    check("Database for migrations", isSet(env.DIRECT_URL), "DIRECT_URL is set"),
    check(
      "Auth secret",
      (env.AUTH_SECRET ?? "").length >= 32,
      "AUTH_SECRET is at least 32 characters",
    ),
    check(
      "Token encryption key",
      base64Bytes(env.TOKEN_ENCRYPTION_KEY) === 32,
      "TOKEN_ENCRYPTION_KEY is 32 bytes, base64",
    ),
    check(
      "Email",
      isSet(env.RESEND_API_KEY) && isSet(env.EMAIL_FROM),
      "RESEND_API_KEY and EMAIL_FROM are set",
    ),
    check(
      "App address",
      (appUrl ?? "").startsWith("https://"),
      "APP_URL (or the Vercel production domain) is https",
    ),
    check(
      "Cron secret",
      (env.CRON_SECRET ?? "").length >= 32,
      "CRON_SECRET is at least 32 characters",
    ),
    check("Plaid environment", env.PLAID_ENV === "production", "PLAID_ENV is production"),
    check(
      "Plaid keys",
      isSet(env.PLAID_CLIENT_ID) && isSet(env.PLAID_SECRET),
      "PLAID_CLIENT_ID and PLAID_SECRET are set",
    ),
    check(
      "Plaid webhook",
      (appUrl ?? "").startsWith("https://"),
      "Plaid webhooks go to an https /api/plaid/webhook",
    ),
    check(
      "Closed beta",
      !["false", "0"].includes((env.BETA_INVITE_ONLY ?? "").trim().toLowerCase()),
      "Sign-up needs an invite code (BETA_INVITE_ONLY isn't false)",
    ),
    check("Admins", isSet(env.ADMIN_EMAILS), "ADMIN_EMAILS names the team"),
    check(
      "Claude explanations",
      isSet(env.ANTHROPIC_API_KEY),
      "ANTHROPIC_API_KEY is set (template text otherwise)",
      false,
    ),
    check(
      "Stripe",
      !isSet(stripeKey) || (stripeKey!.startsWith("sk_live_") && isSet(env.STRIPE_WEBHOOK_SECRET)),
      isSet(stripeKey)
        ? "STRIPE_SECRET_KEY is a live key and STRIPE_WEBHOOK_SECRET is set"
        : "Not set: membership offers Reserve only",
      false,
    ),
    check(
      "Analytics",
      isSet(env.POSTHOG_KEY),
      "POSTHOG_KEY is set (events still save to the database)",
      false,
    ),
  ];
}

export function launchReady(checks: Check[]): boolean {
  return checks.every((c) => c.ok || !c.required);
}
