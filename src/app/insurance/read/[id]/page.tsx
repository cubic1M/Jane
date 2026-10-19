import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { getReading } from "@/lib/insurance/readings";
import { readingHints, readingTitle } from "@/lib/jane-agent/insurance/reading-words";
import { requireUser } from "@/lib/session";
import { dismissReadingForm } from "../../actions";
import { PolicyForm } from "../../forms";

// A policy read from a document (spec step 151): every field Jane read, with where it came
// from, for the person to fix and confirm. Nothing is saved until they do.

const LINK = "font-medium text-emerald-700 hover:underline";

async function ReadingContent({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  await connection();
  const { id } = await params;
  const reading = await getReading(user.id, id);
  if (!reading) notFound();
  const title = readingTitle(reading);

  return (
    <>
      <AppHeader user={user} />
      <Link href="/insurance" className={`text-sm ${LINK}`}>
        ← Insurance
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {reading.status === "waiting" ? "Check what Jane read" : "What Jane read"}
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Jane read {title} from{" "}
          <Link href="/documents" className={LINK}>
            {reading.title}
          </Link>
          . Each field says where it came from. Fix anything that&apos;s off, then confirm.{" "}
          {reading.policyId
            ? "Nothing changes on your insurance until you do."
            : "Nothing is added to your insurance until you do."}
        </p>
      </div>
      {reading.status === "waiting" ? (
        <>
          <PolicyForm
            policyId=""
            values={reading.input}
            reading={{ id: reading.id, hints: readingHints(reading) }}
          />
          <form action={dismissReadingForm}>
            <input type="hidden" name="readingId" value={reading.id} />
            <button type="submit" className={`text-sm ${LINK}`}>
              This isn&apos;t a policy
            </button>
          </form>
        </>
      ) : (
        <p role="status" className="rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
          {reading.status === "confirmed"
            ? "You confirmed this one. It's on your insurance."
            : "You said this isn't a policy, so it's not on your insurance."}
        </p>
      )}
    </>
  );
}

export default function ReadingPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <ReadingContent params={params} />
      </Suspense>
    </main>
  );
}
