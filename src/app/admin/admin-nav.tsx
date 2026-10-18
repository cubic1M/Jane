import Link from "next/link";

export function AdminNav({ email }: { email: string | null | undefined }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 text-sm text-zinc-600 dark:text-zinc-400">
      <nav className="flex flex-wrap gap-x-4 gap-y-1 font-medium">
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">Team</span>
        <Link href="/admin/queue" className="hover:underline">
          Queue
        </Link>
        <Link href="/admin/metrics" className="hover:underline">
          Metrics
        </Link>
        <Link href="/admin/merchants" className="hover:underline">
          Merchants
        </Link>
        <Link href="/admin/partners" className="hover:underline">
          Partners
        </Link>
        <Link href="/admin/invites" className="hover:underline">
          Invites
        </Link>
        <Link href="/admin/errors" className="hover:underline">
          Errors
        </Link>
        <Link href="/admin/launch" className="hover:underline">
          Launch check
        </Link>
      </nav>
      <span className="min-w-0 break-all">{email}</span>
    </header>
  );
}
