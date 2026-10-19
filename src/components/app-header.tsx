import { Suspense } from "react";
import { BackToChat } from "@/components/back-to-chat";
import { DemoBanner } from "@/components/demo-banner";
import { MainNav } from "@/components/main-nav";
import { ProfileMenu } from "@/components/profile-menu";

// The top of every signed-in page (spec step 79): the main menu (a tab bar along the
// bottom on phones), the profile menu with Settings and Sign out, and the demo-bank banner.
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
      <div className="flex items-center gap-4">
        <MainNav />
        <ProfileMenu email={user.email} />
      </div>
      <Suspense>
        <DemoBanner userId={user.id} />
      </Suspense>
      <Suspense>
        <BackToChat messageId={chatMessageId} />
      </Suspense>
    </header>
  );
}
