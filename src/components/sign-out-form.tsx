"use client";

import type { ReactNode } from "react";
import { signOutToHome } from "@/lib/auth-actions";
import { forgetThisTab, stopPushHere } from "@/lib/tab-memory";

// Every way to sign out from a page: what this browser kept for the person goes with the session.
export function SignOutForm({ children }: { children: ReactNode }) {
  return (
    <form
      action={signOutToHome}
      onSubmit={() => {
        forgetThisTab();
        void stopPushHere();
      }}
    >
      {children}
    </form>
  );
}
