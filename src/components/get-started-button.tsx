"use client";

import Link from "next/link";
import { sendEvent } from "@/lib/analytics-client";

const TONES = {
  site: "rounded-full bg-emerald-700 text-white hover:bg-emerald-800 focus-visible:outline-emerald-700",
  // The landing page's own colours (src/app/landing.css).
  landing:
    "bg-[var(--landing-hi)] text-[var(--landing-bg)] hover:bg-[var(--landing-mid)] focus-visible:outline-[var(--landing-hi)]",
};

export function GetStartedButton({ tone = "site" }: { tone?: keyof typeof TONES }) {
  return (
    <Link
      href="/signup"
      onClick={() => sendEvent("get_started_clicked")}
      className={`inline-flex h-12 items-center justify-center px-8 text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${TONES[tone]}`}
    >
      <span aria-hidden="true">[&nbsp;</span>
      Get started
      <span aria-hidden="true">&nbsp;]</span>
    </Link>
  );
}
