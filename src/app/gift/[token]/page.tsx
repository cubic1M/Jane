import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { GIFT_ANNUAL_EXCLUSION_CENTS, GIFT_EXCLUSION_SOURCE } from "@/config/family";
import { giftPage } from "@/lib/investments/family";
import { formatCents } from "@/lib/money";
import { GiftForm } from "./gift-form";
import { ProgressBar } from "@/components/progress-bar";

// A gift link (spec step 213): the goal and how far along it is, and nothing else about
// the family. Not indexed by search engines. A demo: no real money moves.

export const metadata: Metadata = { title: "Give to a college fund", robots: { index: false } };

async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ thanks?: string }>;
}) {
  await connection();
  const { token } = await params;
  const { thanks } = await searchParams;
  const gift = await giftPage(token);
  if (!gift) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          This link isn&apos;t taking gifts anymore
        </h1>
        <Link href="/" className="font-medium text-emerald-700 hover:underline">
          See what Jane does
        </Link>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm text-emerald-700">A gift for {gift.childName}</p>
      <h1 className="text-4xl font-semibold tracking-tight">{gift.goalName}</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        The goal is {formatCents(gift.targetCents)}, and it is {gift.percent}% of the way there.
      </p>
      <ProgressBar label="How far along the goal is" percent={gift.percent} tall />
      {thanks === "1" && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          Thank you! Your gift was added.
        </p>
      )}
      <GiftForm token={token} />
      <p className="text-xs text-zinc-500">
        This is a demo of Jane: no real money moves. A gift can be up to{" "}
        {formatCents(GIFT_ANNUAL_EXCLUSION_CENTS)} a year without a gift tax return (
        {GIFT_EXCLUSION_SOURCE}).
      </p>
    </section>
  );
}

export default function GiftPage(props: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ thanks?: string }>;
}) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-4 py-16 sm:px-6">
      <Suspense>
        <Page params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
