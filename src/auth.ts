import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { createAuthAdapter } from "@/lib/auth-adapter";
import { allowSignIn } from "@/lib/auth-gate";
import { recordSignIn } from "@/lib/auth-events";
import { db } from "@/lib/db";
import { sendMagicLink } from "@/lib/email";

// Google is optional until its OAuth client is set up; the button hides without it.
export const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

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
    session({ session, user }) {
      return {
        ...session,
        user: { ...session.user, id: user.id, role: user.role, termsVersion: user.termsVersion },
      };
    },
  },
  events: {
    signIn: recordSignIn,
  },
});
