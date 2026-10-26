import { cookies } from "next/headers";
import { after } from "next/server";
import { track } from "@/lib/analytics";
import { ANONYMOUS_ID_COOKIE } from "@/lib/analytics-events";
import { SYSTEM_ACTOR, logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { isAdminEmail } from "@/lib/invites";
import { TERMS_COOKIE, acceptTerms } from "@/lib/terms";
import { TERMS_VERSION } from "@/config/legal";

type SignInEvent = {
  user: { id?: string | null; email?: string | null };
  account?: { provider: string } | null;
  isNewUser?: boolean;
};

// Auth.js calls the email provider "resend"; analytics and the audit log say "email".
export function signInMethod(provider: string | undefined): string {
  return provider === "resend" ? "email" : (provider ?? "unknown");
}

// Runs after every successful sign-in, including the first one that creates the user.
export async function recordSignIn({ user, account, isNewUser }: SignInEvent): Promise<void> {
  if (!user.id) return;
  const actor = { type: "user" as const, id: user.id };
  const target = { type: "user", id: user.id };
  const method = signInMethod(account?.provider);

  if (isNewUser) {
    await logAudit(actor, "user_signed_up", target, { method });
    // The anonymous id ties the sign-up back to the visitor's landing-page events.
    const anonymousId = (await cookies()).get(ANONYMOUS_ID_COOKIE)?.value ?? null;
    await track(user.id, "signup_completed", { method, anonymous_id: anonymousId });
    // Consent given on /signup, if this browser is the one that signed up.
    if ((await cookies()).get(TERMS_COOKIE)?.value === TERMS_VERSION) {
      await acceptTerms(user.id, { via: "signup" });
    }
  }
  await logAudit(actor, "user_signed_in", target, { method });
  // ADMIN_EMAILS makes the founders admins without editing the database by hand.
  if (user.email && isAdminEmail(user.email)) {
    const { count } = await db.user.updateMany({
      where: { id: user.id, role: "user" },
      data: { role: "admin" },
    });
    if (count > 0) await logAudit(actor, "user_made_admin", target, { via: "ADMIN_EMAILS" });
  }
  // Counts as activity, so linked banks aren't removed for inactivity (step 11).
  await track(user.id, "signed_in", { method });
}

// Why a sign-in didn't work, for the access log: Auth.js's error types for a bad or used link,
// a refused or broken return from Google, and a forged request. Never the address tried.
const FAILED_SIGN_IN_TYPES = new Set([
  "AccessDenied",
  "Verification",
  "OAuthCallbackError",
  "OAuthSignInError",
  "OAuthAccountNotLinked",
  "OAuthProfileParseError",
  "CallbackRouteError",
  "EmailSignInError",
  "InvalidCheck",
  "MissingCSRF",
]);

// A sign-in that didn't work: on the access log with the request's IP and browser.
export async function recordFailedSignIn(reason: string): Promise<void> {
  await logAudit(SYSTEM_ACTOR, "sign_in_failed", null, { reason: reason.slice(0, 40) });
}

// Auth.js's logger.error: the kind of error on the server log (not its details, which can
// hold the address tried), and a failed sign-in on the access log, after the response.
export function logAuthError(error: Error): void {
  const type = (error as { type?: string }).type ?? error.name;
  console.error("[auth][error]", type);
  if (!FAILED_SIGN_IN_TYPES.has(type)) return;
  const write = () =>
    recordFailedSignIn(type).catch((e) =>
      console.error("Couldn't log a failed sign-in", {
        error: e instanceof Error ? e.name : "unknown",
      }),
    );
  try {
    after(write);
  } catch {
    void write();
  }
}
