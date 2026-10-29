import Link from "next/link";

// The /try link's answer when one address has made too many sample people this hour (the
// same limit as "Try it with sample data", src/config/rate-limits.ts).
export default function TryBusyPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Lots of people are trying Jane</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Many sample people were made from this address in the last hour. Please try again in an
        hour.
      </p>
      <Link href="/" className="font-medium underline underline-offset-2 hover:no-underline">
        Back to Jane
      </Link>
    </main>
  );
}
