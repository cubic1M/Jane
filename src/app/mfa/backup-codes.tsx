import Link from "next/link";

// Shown once, right after the codes are made.
export function BackupCodes({ codes, next }: { codes: string[]; next?: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-300 p-4 dark:border-amber-800">
      <h2 className="font-semibold">Save your backup codes</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        If you lose your phone, each of these works once instead of a code. Keep them somewhere
        safe, like a password manager. We won&apos;t show them again.
      </p>
      <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((code) => (
          <li key={code} className="rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-900">
            {code}
          </li>
        ))}
      </ul>
      {next && (
        <Link
          href={next}
          className="inline-flex h-11 items-center justify-center rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800"
        >
          I&apos;ve saved them, continue
        </Link>
      )}
    </div>
  );
}
