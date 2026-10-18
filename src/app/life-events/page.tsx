import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { listLifeEvents } from "@/lib/life-events";
import { requireUser } from "@/lib/session";
import { LifeEventsBoard } from "./board";

// Life-event checklists (spec step 72): the money to-dos for moving, a new job or a new
// baby. Organizing only.

async function LifeEvents() {
  const user = await requireUser();
  const events = await listLifeEvents(user.id);

  return (
    <>
      <AppHeader email={user.email} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Life events</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Big changes come with a list of money chores. Start a checklist and tick things off as you
          go.
        </p>
      </div>
      <LifeEventsBoard
        events={events.map((e) => ({
          ...e,
          completedAt: e.completedAt?.toISOString() ?? null,
        }))}
      />
    </>
  );
}

export default function LifeEventsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <LifeEvents />
      </Suspense>
    </main>
  );
}
