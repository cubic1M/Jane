import Link from "next/link";
import type { Route } from "next";

// What a page says when there's nothing on it yet, for a new person (overnight beta pass: an
// upload-only person with one card statement): a line, and the one next step. Never "$0.00" rows
// or a "–" table that reads as broken.
export function EmptyState({
  words,
  next,
}: {
  words: string;
  next?: { href: string; label: string };
}) {
  return (
    <div
      data-empty-state=""
      className="flex flex-col gap-2 rounded-xl border border-dashed border-zinc-300 p-4 text-sm dark:border-zinc-700"
    >
      <p className="text-zinc-700 dark:text-zinc-300">{words}</p>
      {next && (
        <Link href={next.href as Route} className="self-start font-semibold underline">
          {next.label}
        </Link>
      )}
    </div>
  );
}
