import Link from "next/link";

// What a broken or missing page shows instead of a blank screen (src/app/error.tsx,
// not-found.tsx, global-error.tsx): what happened in a line, and the way on: Home, and
// Report a problem about this page.
export function ErrorScreen({
  title,
  words,
  from,
  retry,
}: {
  title: string;
  words: string;
  // The page it happened on, for the report.
  from: string;
  retry?: React.ReactNode;
}) {
  return (
    <main
      data-error-screen=""
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-16 sm:px-6"
    >
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="text-zinc-600 dark:text-zinc-400">{words}</p>
      <div className="flex flex-wrap items-center gap-4">
        {retry}
        <Link href="/home" className="font-semibold underline">
          Go to Home
        </Link>
        <Link
          href={`/report-a-problem?from=${encodeURIComponent(from)}`}
          className="font-semibold underline"
        >
          Report a problem
        </Link>
      </div>
    </main>
  );
}
