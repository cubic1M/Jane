"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { FROM_PARAM, chatMessageHref } from "@/lib/jane-agent/back-link";

// Spec step 86: on a detail page opened from one of Jane's messages, a link back to that
// message in the chat. A page can name its message itself (a finding's card knows which
// message was about it); otherwise it's the one in the address (?from=…).
export function BackToChat({ messageId }: { messageId?: string | null }) {
  const pathname = usePathname();
  const from = useSearchParams().get(FROM_PARAM);
  const href = chatMessageHref(from ?? messageId);
  if (!href || pathname === "/chat") return null;
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center self-start text-sm font-medium text-emerald-700 hover:underline print:hidden"
    >
      ‹ Back to the chat
    </Link>
  );
}
