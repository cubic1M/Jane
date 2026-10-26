import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { createAuthAdapter } from "@/lib/auth-adapter";
import { googleConfigured } from "@/lib/auth-providers";
import { allowSignIn } from "@/lib/auth-gate";
import { recordSignIn } from "@/lib/auth-events";
import { sessionPayload } from "@/lib/auth-session";
import { db } from "@/lib/db";
import { sendMagicLink } from "@/lib/email";

// Google is optional until its OAuth client is set up (docs/setup/google-sign-in.md): without
// both keys the provider isn't registered and the button hides.
export const googleEnabled = googleConfigured();

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: createAuthAdapter(db),
  // Database sessions, so signing out or deleting a user ends their session immediately.
  session: { strategy: "database" },
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM,
      sendVerificationRequest: ({ identifier, url }) => sendMagicLink({ to: identifier, url }),
    }),
    // Google only hands out verified emails, so a Google sign-in may join an account
    // first created with a magic link to the same address.
    ...(googleEnabled ? [Google({ allowDangerousEmailAccountLinking: true })] : []),
  ],
  pages: {
    signIn: "/login",
    verifyRequest: "/login/check-email",
    error: "/login",
  },
  callbacks: {
    // The beta is invite-only: new accounts need a redeemed invite code.
    signIn: allowSignIn,
    // Only what the app needs: never the session token.
    session: ({ session, user }) => sessionPayload({ session, user }),
  },
  events: {
    signIn: recordSignIn,
  },
});
