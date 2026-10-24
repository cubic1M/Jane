import Link from "next/link";
import { Suspense } from "react";
import { AreaTabs } from "@/components/area-tabs";
import { BackToChat } from "@/components/back-to-chat";
import { DemoBanner } from "@/components/demo-banner";
import { ProfileMenu } from "@/components/profile-menu";
import { ScanBarGate } from "@/components/scan-bar-gate";
import { ChatToggle } from "@/components/side-chat/chat-toggle";
import { SideChatUser } from "@/components/side-chat/side-chat";

// The top of every signed-in page (spec step 79; the home hub, docs/design/home-hub.md): Jane's
// name, the area tabs, the Chat button (computer) and the profile menu with What Jane did,
// Settings and Sign out, then the demo-bank banner. On a computer the bar is fixed across the
// top of the window and the chat is docked beside the page; on a phone it scrolls with the
// page and the tabs scroll sideways. It also tells the side chat (in the root layout) who is
// signed in, so the chat shows on this page.
// Takes the person the page already looked up, so the header never reads the session again:
// a second lookup can land after the browser has gone, where Next.js rejects it.
// Spec step 86: a page opened from one of Jane's messages links back to it; a page that
// knows its message passes chatMessageId.
export function AppHeader({
  user,
  chatMessageId,
}: {
  user: { id: string; email?: string | null };
  chatMessageId?: string | null;
}) {
  return (
    <header className="flex flex-col gap-3 text-sm">
      <div
        id="app-top-bar"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:fixed lg:inset-x-0 lg:top-0 lg:z-40 lg:h-14 lg:flex-nowrap lg:border-b lg:border-zinc-300 lg:bg-white lg:px-4 dark:lg:border-zinc-700 dark:lg:bg-zinc-950 print:static"
      >
        <Link
          href="/home"
          className="inline-flex min-h-11 shrink-0 items-center text-base font-bold tracking-tight"
        >
          <span aria-hidden className="text-emerald-700">
            &gt;
          </span>
          Jane
        </Link>
        <div className="order-last w-full min-w-0 lg:order-none lg:w-auto lg:flex-1">
          <AreaTabs />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ChatToggle />
          <ProfileMenu email={user.email} />
        </div>
      </div>
      <SideChatUser userId={user.id} />
      {/* The first scan's loading bar, across the top of every page while it runs. */}
      <Suspense>
        <ScanBarGate userId={user.id} />
      </Suspense>
      <Suspense>
        <DemoBanner userId={user.id} />
      </Suspense>
      <Suspense>
        <BackToChat messageId={chatMessageId} />
      </Suspense>
    </header>
  );
}
