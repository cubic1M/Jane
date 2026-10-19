import { Suspense } from "react";
import { DemoBanner } from "@/components/demo-banner";
import { MainNav } from "@/components/main-nav";
import { ProfileMenu } from "@/components/profile-menu";

// The top of every signed-in page (spec step 79): the main menu (a tab bar along the
// bottom on phones), the profile menu with Settings and Sign out, and the demo-bank banner.
// Takes the person the page already looked up, so the header never reads the session again:
// a second lookup can land after the browser has gone, where Next.js rejects it.
export function AppHeader({ user }: { user: { id: string; email?: string | null } }) {
  return (
    <header className="flex flex-col gap-3 text-sm">
      <div className="flex items-center gap-4">
        <MainNav />
        <ProfileMenu email={user.email} />
      </div>
      <Suspense>
        <DemoBanner userId={user.id} />
      </Suspense>
    </header>
  );
}
