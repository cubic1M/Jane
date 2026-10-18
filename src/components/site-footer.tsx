import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mx-auto flex w-full max-w-3xl flex-wrap gap-x-4 gap-y-1 px-4 py-6 text-xs text-zinc-500 sm:px-6 print:hidden">
      <Link href="/privacy" className="hover:underline">
        Privacy
      </Link>
      <Link href="/terms" className="hover:underline">
        Terms
      </Link>
      <Link href="/security" className="hover:underline">
        Security
      </Link>
    </footer>
  );
}
