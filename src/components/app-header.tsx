import { Suspense } from "react";
import { AreaTabs } from "@/components/area-tabs";
import { BackToChat } from "@/components/back-to-chat";
import { DemoBanner } from "@/components/demo-banner";
import { LoadingBar } from "@/components/loading-bar";
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
const TOP_BAR =
  "flex flex-wrap items-center gap-x-3 gap-y-1 lg:fixed lg:inset-x-0 lg:top-0 lg:z-50 lg:h-14 lg:flex-nowrap lg:border-b lg:border-zinc-300 lg:bg-white lg:px-4 dark:lg:border-zinc-700 dark:lg:bg-zinc-950 print:static";

// Just the logo (founder: "It should just be the logo, and no interaction"): Home and the area
// tabs are where the pages are. The loading bar's copy isn't marked as the page's logo.
function JaneLogo({ marked = true }: { marked?: boolean }) {
  return (
    <span
      data-jane-logo={marked ? "" : undefined}
      className="inline-flex min-h-11 shrink-0 cursor-default items-center text-base font-bold tracking-tight select-none"
    >
      <span aria-hidden className="text-emerald-700">
        &gt;
      </span>
      Jane
    </span>
  );
}

export function AppHeader({
  user,
  chatMessageId,
}: {
  user: { id: string; email?: string | null };
  chatMessageId?: string | null;
}) {
  return (
    <header className="flex flex-col gap-3 text-sm">
      {/* Above the docked chat (z-40), so the profile menu opens over it and Sign out can be
          pressed; the chat expanded to the whole window (z-50, later on the page) still covers it. */}
      <div id="app-top-bar" data-app-top-bar="" className={TOP_BAR}>
        <JaneLogo />
        <div className="order-last w-full min-w-0 lg:order-none lg:w-auto lg:flex-1">
          <AreaTabs />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ChatToggle />
          <ProfileMenu email={user.email} />
        </div>
      </div>
      <SideChatUser userId={user.id} />
      {/* A tapped link's loading bar (src/components/nav-pending.tsx) shows here, in the flow. */}
      <div id="page-loading" />
      {/* The first scan's loading bar, under the top bar of every page while it runs. */}
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

// The top bar while a page loads (reviewer polish): the same bar, logo and tabs, with the
// profile button's room kept, so the page doesn't draw full width and then jump under the bar
// and beside the docked chat (the room is made for [data-app-top-bar], globals.css), and a tap
// on a tab never makes the bar blink away. It needs no session, so it shows in the first frame.
// Not the page's own bar or logo (no id, no logo mark): while the page streams in, both are in
// the document for a moment, and #app-top-bar must stay one element.
export function AppHeaderLoading() {
  return (
    <header className="flex flex-col gap-3 text-sm" data-header-loading="">
      <div data-app-top-bar="" className={TOP_BAR}>
        <JaneLogo marked={false} />
        <div className="order-last w-full min-w-0 lg:order-none lg:w-auto lg:flex-1">
          <AreaTabs />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ChatToggle />
          <span
            aria-hidden
            className="size-11 rounded-full border border-zinc-300 dark:border-zinc-700"
          />
        </div>
      </div>
    </header>
  );
}

// A signed-in page's own fallback: the top bar, then the loading bar where the page will be.
export function PageLoading({ label }: { label?: string }) {
  return (
    <>
      <AppHeaderLoading />
      <LoadingBar label={label} />
    </>
  );
}
