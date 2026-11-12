"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isTrialUser } from "@/lib/trial-ids";

// The landing page is the same for everyone (it's built once, not per visitor), so a student who
// is signed in and opens the site's address saw only "Get started" and "Sign in", as if signed
// out (beta walk 11-12, from the debugger). This asks the session once in the browser and, for a
// signed-in account, offers the way in. A sample person trying Jane keeps the page as it is.
export function OpenJaneLink() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { user?: { id?: unknown } } | null) => {
        const id = s?.user?.id;
        if (live && typeof id === "string" && !isTrialUser(id)) setSignedIn(true);
      })
      .catch(() => {
        // Offline or blocked: the page stays as it is for everyone.
      });
    return () => {
      live = false;
    };
  }, []);
  if (!signedIn) return null;
  return (
    <p data-open-jane="" className="w-full text-[var(--landing-mid)]">
      You&apos;re signed in.{" "}
      <Link
        href="/home"
        className="font-semibold text-[var(--landing-hi)] underline underline-offset-2 hover:no-underline"
      >
        Open Jane
      </Link>
    </p>
  );
}
