import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { loadDisasterRelief } from "@/lib/disasters";
import { DISASTER_HREF, disasterReply, reliefLines } from "@/lib/jane-agent/disaster-message";
import { requireUser } from "@/lib/session";
import { ReliefButtons } from "./forms";

// Disasters and losses (spec step 270): an IRS postponement for the person's county moving their
// tax deadlines, and the casualty loss after insurance kept with the claim, once. The same lines
// as the chat's answer (reliefLines); the buttons do what the chat's do. Nothing is filed.

const LINK = "font-medium text-emerald-700 underline";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

async function Content() {
  const user = await requireUser();
  await connection();
  const v = await loadDisasterRelief(user.id);
  return (
    <>
      <AppHeader user={user} />
      <Link href="/taxes" className={`text-sm ${LINK}`}>
        ← Taxes
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Disasters and losses</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          When the IRS postpones tax deadlines for your county after a disaster, Jane moves yours,
          and keeps a loss insurance didn&apos;t cover with the claim. Jane files nothing.
        </p>
      </div>
      {v.relief.length === 0 ? (
        <p className="text-sm">{disasterReply(v).body}</p>
      ) : (
        v.relief.map((r) => (
          <section key={r.relief.id} aria-label={r.relief.title} className={CARD}>
            <h2 className="text-xl font-semibold">
              {r.relief.title}, {v.county} County
            </h2>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
              {reliefLines(r).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <ReliefButtons
              relief={r.relief.id}
              canMove={!r.applied && r.moves.length > 0}
              canRecord={r.loss.repairsCents > 0 && !r.recorded}
            />
            <Link href={DISASTER_HREF} className={`text-sm ${LINK}`}>
              See my deadlines
            </Link>
          </section>
        ))
      )}
    </>
  );
}

export default function DisastersPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <Content />
      </Suspense>
    </main>
  );
}
