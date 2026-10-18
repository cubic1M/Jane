import Link from "next/link";
import { signOutToHome } from "@/lib/auth-actions";

export function AppHeader({ email }: { email: string | null | undefined }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 text-sm text-zinc-600 dark:text-zinc-400">
      <nav className="flex flex-wrap gap-x-4 gap-y-1 font-medium">
        <Link href="/home" className="hover:underline">
          Home
        </Link>
        <Link href="/connect" className="hover:underline">
          Accounts
        </Link>
        <Link href="/report" className="hover:underline">
          Report
        </Link>
        <Link href="/insights" className="hover:underline">
          Insights
        </Link>
        <Link href="/actions" className="hover:underline">
          Actions
        </Link>
        <Link href="/alerts" className="hover:underline">
          Alerts
        </Link>
        <Link href="/settings" className="hover:underline">
          Settings
        </Link>
      </nav>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        {/* Long emails wrap instead of pushing the page sideways on a phone. */}
        <span className="min-w-0 break-all">Signed in as {email}</span>
        <form action={signOutToHome}>
          <button type="submit" className="font-medium text-emerald-700 hover:underline">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
