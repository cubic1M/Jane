"use client";

import Link from "next/link";
import { sendEvent } from "@/lib/analytics-client";

export function GetStartedButton() {
  return (
    <Link
      href="/signup"
      onClick={() => sendEvent("get_started_clicked")}
      className="inline-flex h-12 items-center justify-center rounded-full bg-emerald-700 px-8 text-base font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
    >
      <span aria-hidden="true">[&nbsp;</span>
      Get started
      <span aria-hidden="true">&nbsp;]</span>
    </Link>
  );
}
