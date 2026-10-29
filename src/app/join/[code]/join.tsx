import Link from "next/link";
import type { InviteLanding } from "@/lib/share-invites";

// The invite page's content (./page.tsx): what Jane is in one line and one button. A working
// invite goes to sign-up with its code filled in; a used-up or wrong one to the waitlist.

export const ONE_LINE = "Jane reads your bank accounts and finds the money you're losing.";
const BUTTON =
  "inline-flex h-12 items-center justify-center rounded-full bg-zinc-900 px-8 text-base font-semibold text-white hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus-visible:outline-white";

export function JoinContent({ landing }: { landing: InviteLanding | null }) {
  const open = Boolean(landing?.open);
  return (
    <section className="flex flex-col gap-6" data-join={open ? "open" : "closed"}>
      <p className="text-sm font-semibold tracking-widest">[JANE]</p>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{ONE_LINE}</h1>
      {landing && !open && (
        <p role="status" className="text-zinc-600 dark:text-zinc-400">
          This invite has been used up. Leave your email and a founder will invite you.
        </p>
      )}
      {!landing && (
        <p role="status" className="text-zinc-600 dark:text-zinc-400">
          This invite link isn&apos;t valid. Leave your email and a founder will invite you.
        </p>
      )}
      <div>
        <Link
          href={open && landing ? `/signup?invite=${landing.code}` : "/signup"}
          className={BUTTON}
        >
          <span aria-hidden="true">[&nbsp;</span>
          {open ? "Join the beta" : "Join the waitlist"}
          <span aria-hidden="true">&nbsp;]</span>
        </Link>
      </div>
    </section>
  );
}
