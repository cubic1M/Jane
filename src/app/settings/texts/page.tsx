import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { scopedDb } from "@/lib/db-scoped";
import { messagingMode } from "@/lib/messaging/provider";
import { requireUser } from "@/lib/session";
import { ReplyForm } from "./reply-form";

// The simulated phone (spec step 78): only outside production with no Sendblue keys. It
// shows the texts Jane "sent" to the person and lets them answer as their phone would,
// so the whole loop (plan text, YES or numbers, UNDO, STOP) can be tried without keys.
async function Content() {
  if (messagingMode() !== "simulated") notFound();
  const user = await requireUser();
  const texts = await (
    await scopedDb()
  ).textMessages.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, direction: true, kind: true, body: true, status: true, createdAt: true },
  });

  return (
    <>
      <AppHeader email={user.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Simulated phone</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        For trying texts without Sendblue keys: nothing here is really sent. Texts waiting for
        morning (quiet hours) show as queued.{" "}
        <Link href="/settings#texts" className="font-medium text-emerald-700 hover:underline">
          Back to settings
        </Link>
      </p>
      <ReplyForm />
      <ol className="flex flex-col gap-2">
        {texts.map((t) => (
          <li
            key={t.id}
            className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap break-words ${
              t.direction === "inbound"
                ? "self-end bg-emerald-700 text-white"
                : "self-start bg-zinc-100 dark:bg-zinc-900"
            }`}
          >
            {t.body}
            <span className="mt-1 block text-xs opacity-70">
              {t.direction === "inbound" ? "You" : "Jane"} · {t.kind} · {t.status} ·{" "}
              {t.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
            </span>
          </li>
        ))}
      </ol>
      {texts.length === 0 && <p className="text-zinc-500">No texts yet.</p>}
    </>
  );
}

export default function SimulatedPhonePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
