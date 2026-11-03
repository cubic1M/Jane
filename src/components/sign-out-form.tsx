"use client";

import type { ReactNode } from "react";
import { signOutToHome } from "@/lib/auth-actions";
import { forgetOnThisBrowser } from "@/lib/tab-memory";

// Signing out from a server component's page. What this browser kept goes with the session.
export function SignOutForm({ children }: { children: ReactNode }) {
  return (
    <form action={signOutToHome} onSubmit={forgetOnThisBrowser}>
      {children}
    </form>
  );
}
