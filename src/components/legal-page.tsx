import Link from "next/link";
import type { ReactNode } from "react";
import { TERMS_VERSION, legalReviewed } from "@/config/legal";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ‹ Home
      </Link>
      {!legalReviewed() && (
        <p
          role="note"
          className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          Draft, pending legal review. This page describes how the app works today; the final
          wording may change.
        </p>
      )}
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-zinc-500">Version {TERMS_VERSION}</p>
      <div className="flex flex-col gap-4 leading-relaxed text-zinc-700 dark:text-zinc-300 [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-zinc-900 dark:[&_h2]:text-zinc-100 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </main>
  );
}
