import { cookies } from "next/headers";
import { track } from "@/lib/analytics";
import { ANONYMOUS_ID_COOKIE } from "@/lib/analytics-events";
import { logAudit } from "@/lib/audit";
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
