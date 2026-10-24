import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { EXPLAINERS, REVIEW_NOTE, explainer } from "@/config/learn";
import { requireUser } from "@/lib/session";
import { LoadingBar } from "@/components/loading-bar";

// One explainer (spec step 136), with its sources and its review status.

async function ExplainerContent({ params }: { params: PageProps<"/learn/[slug]">["params"] }) {
  const user = await requireUser();
  await connection();
  const { slug } = await params;
  const e = explainer(slug);
  if (!e) notFound();
  const others = EXPLAINERS.filter((x) => x.slug !== e.slug);
  return (
    <>
      <AppHeader user={user} />
      <article className="flex flex-col gap-4">
        <Link href="/learn" className="text-sm font-medium text-emerald-700 hover:underline">
          ← Learn
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{e.title}</h1>
        <p className="text-lg">{e.summary}</p>
        {e.paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
        <section className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
          <h2 className="font-semibold">Sources</h2>
          <ul className="list-disc pl-5">
            {e.sources.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
        <p role="note" className="text-xs text-zinc-500">
          {e.review.status === "reviewed" ? `Reviewed by ${e.review.reviewedBy}.` : REVIEW_NOTE}
        </p>
      </article>
      <nav aria-label="More explainers" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {others.map((o) => (
          <Link key={o.slug} href={`/learn/${o.slug}`} className="text-emerald-700 hover:underline">
            {o.title}
          </Link>
        ))}
      </nav>
    </>
  );
}

export default function ExplainerPage(props: PageProps<"/learn/[slug]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <ExplainerContent params={props.params} />
      </Suspense>
    </main>
  );
}
