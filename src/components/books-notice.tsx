import Link from "next/link";
import type { BooksView } from "@/lib/books";
import { booksFix } from "@/lib/books-fix";

// Books that balance (spec step 238): figures that rely on data Jane isn't sure of are marked
// until it's fixed, with what's wrong in words and where to fix each one. skipItems: banks
// whose trouble is already said elsewhere on the page (Home's bank notice), not said twice.
export function BooksNotice({
  books,
  skipItems = [],
}: {
  books: BooksView;
  skipItems?: readonly string[];
}) {
  const worrying = books.open.filter(
    (o) => o.kind !== "transfer" && !(o.itemId && skipItems.includes(o.itemId)),
  );
  if (worrying.length === 0) return null;
  return (
    <aside
      role="note"
      className="flex flex-col gap-1 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100"
    >
      <strong>Some figures here rely on data I&apos;m still checking.</strong>
      <ul className="flex flex-col gap-2">
        {worrying.map((o) => {
          const fix = booksFix(o);
          return (
            <li key={o.id} className="flex flex-col gap-0.5">
              <span>{o.words}</span>
              <Link href={fix.href} className="self-start font-medium underline">
                {fix.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
