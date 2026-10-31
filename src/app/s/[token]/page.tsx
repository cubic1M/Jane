import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { GetStartedButton } from "@/components/get-started-button";
import { formatCents } from "@/lib/money";
import { sharedTotal } from "@/lib/savings-proof";

// A shared "What Jane saved me" total (spec step 139): the number and nothing else about
// the person. Not indexed by search engines.

export const metadata: Metadata = { title: "What Jane saved me", robots: { index: false } };

async function Shared({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const shared = await sharedTotal(token);
  if (!shared) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          This link isn&apos;t shared anymore
        </h1>
        <Link href="/" className="font-medium text-emerald-700 hover:underline">
          See what Jane does
        </Link>
      </section>
    );
  }
  const asOf = shared.createdAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: shared.timezone,
  });
  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm text-emerald-700">What Jane saved me</p>
      <h1 className="text-5xl font-semibold tracking-tight">{formatCents(shared.totalCents)}</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Refunds and lower bills Jane got for me, each one seen in my own bank transactions, as of{" "}
        {asOf}.
      </p>
      <div>
        <GetStartedButton />
      </div>
    </section>
  );
}

export default function SharedSavedPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-4 py-16 sm:px-6">
      <Suspense>
        <Shared params={params} />
      </Suspense>
    </main>
  );
}
