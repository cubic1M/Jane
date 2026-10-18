import type { DefaultSession } from "next-auth";
import type { Role } from "@/generated/prisma/client";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: Role; termsVersion: string | null } & DefaultSession["user"];
    // Two-factor is on and this session hasn't entered a code yet: nothing opens but /mfa.
    mfaPending: boolean;
  }
}

declare module "@auth/core/adapters" {
  interface AdapterUser {
    role: Role;
    termsVersion: string | null;
    mfaEnabled: boolean;
  }
  interface AdapterSession {
    // A two-factor code was entered in this session.
    mfaVerified?: boolean;
  }
}
