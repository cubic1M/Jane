import type { ReactNode } from "react";

// Signing in and up share one main landmark (QA, 2026-10-26). With cacheComponents, the page
// someone came from stays mounted, hidden, after a client-side move (the sign-in form's redirect
// to "Check your email"), so a main in each page would leave two in the document.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-20">
      {children}
    </main>
  );
}
