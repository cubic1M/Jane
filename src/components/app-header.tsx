import Link from "next/link";
import { signOutToHome } from "@/lib/auth-actions";

export function AppHeader({ email }: { email: string | null | undefined }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 text-sm text-zinc-600 dark:text-zinc-400">
      <nav className="flex gap-4 font-medium">
        <Link href="/import" className="hover:underline">
          Import
        </Link>
        <Link href="/report" className="hover:underline">
          Report
        </Link>
      </nav>
      <div className="flex items-center gap-4">
        <span>Signed in as {email}</span>
        <form action={signOutToHome}>
          <button type="submit" className="font-medium text-emerald-700 hover:underline">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
