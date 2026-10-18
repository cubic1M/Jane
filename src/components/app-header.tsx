import { Suspense } from "react";
import { DemoBanner } from "@/components/demo-banner";
import { MainNav } from "@/components/main-nav";
import { ProfileMenu } from "@/components/profile-menu";

// The top of every signed-in page (spec step 79): the main menu (a tab bar along the
// bottom on phones), the profile menu with Settings and Sign out, and the demo-bank banner.
export function AppHeader({ email }: { email: string | null | undefined }) {
  return (
    <header className="flex flex-col gap-3 text-sm">
      <div className="flex items-center gap-4">
        <MainNav />
        <ProfileMenu email={email} />
      </div>
      <Suspense>
        <DemoBanner />
      </Suspense>
    </header>
  );
}
