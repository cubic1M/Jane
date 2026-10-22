import Link from "next/link";
import type { BooksView } from "@/lib/books";

// Books that balance (spec step 238): figures that rely on data Jane isn't sure of are marked
// until it's fixed, with what's wrong in words.
export function BooksNotice({ books }: { books: BooksView }) {
  const worrying = books.open.filter((o) => o.kind !== "transfer");
  if (worrying.length === 0) return null;
  return (
    <aside
      role="note"
      className="flex flex-col gap-1 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100"
    >
      <strong>Some figures here rely on data I&apos;m still checking.</strong>
      <ul className="flex flex-col gap-1">
        {worrying.map((o) => (
          <li key={o.id}>{o.words}</li>
        ))}
      </ul>
      <Link href="/connect" className="font-medium underline">
        Check my linked accounts
      </Link>
    </aside>
  );
}
