"use client";

import Link from "next/link";
import { useActionState } from "react";
import { LIFE_EVENTS, LIFE_EVENT_KINDS, type LifeEventKind } from "@/config/life-events";
import { updateLifeEvents, type LifeEventState } from "./actions";

export type BoardEvent = {
  id: string;
  kind: LifeEventKind;
  startedOn: string;
  checkedItems: string[];
  completedAt: string | null;
};

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full px-5 text-sm font-medium disabled:opacity-60";

const day = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

function Hidden({ values }: { values: Record<string, string> }) {
  return (
    <>
      {Object.entries(values).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  );
}

export function LifeEventsBoard({ events }: { events: BoardEvent[] }) {
  const [state, action, pending] = useActionState<LifeEventState, FormData>(updateLifeEvents, null);
  const open = events.filter((e) => e.completedAt === null);
  const finished = events.filter((e) => e.completedAt !== null);
  const notStarted = LIFE_EVENT_KINDS.filter((k) => !open.some((e) => e.kind === k));

  return (
    <>
      <p
        role="status"
        className={
          state
            ? `rounded-lg p-3 text-sm ${
                state.ok
                  ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
                  : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"
              }`
            : "sr-only"
        }
      >
        {state?.message ?? ""}
      </p>

      {open.map((event) => {
        const checklist = LIFE_EVENTS[event.kind];
        const done = checklist.items.filter((i) => event.checkedItems.includes(i.key)).length;
        return (
          <section
            key={event.id}
            aria-labelledby={`event-${event.id}`}
            className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`event-${event.id}`} className="text-xl font-semibold">
                {checklist.title}
              </h2>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                {done} of {checklist.items.length} done · started {day(event.startedOn)}
              </span>
            </div>
            <ul className="flex flex-col gap-2">
              {checklist.items.map((item) => {
                const checked = event.checkedItems.includes(item.key);
                return (
                  <li key={item.key} className="flex flex-col gap-x-3 sm:flex-row sm:items-center">
                    <form action={action} className="min-w-0 sm:flex-1">
                      <Hidden values={{ intent: "tick", eventId: event.id, item: item.key }} />
                      <button
                        type="submit"
                        aria-pressed={checked}
                        disabled={pending}
                        className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
                      >
                        <span
                          aria-hidden="true"
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${
                            checked
                              ? "border-emerald-700 bg-emerald-700 text-white"
                              : "border-zinc-400 dark:border-zinc-600"
                          }`}
                        >
                          {checked ? "✓" : ""}
                        </span>
                        <span
                          className={`[overflow-wrap:anywhere] ${checked ? "text-zinc-500 line-through" : ""}`}
                        >
                          {item.label}
                        </span>
                      </button>
                    </form>
                    {item.href && (
                      <Link
                        href={item.href}
                        className={`pb-2 pl-10 text-sm sm:pb-0 sm:pl-0 ${LINK}`}
                      >
                        {item.linkLabel}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-3">
              <form action={action}>
                <Hidden values={{ intent: "finish", eventId: event.id }} />
                <button
                  type="submit"
                  disabled={pending}
                  className={`${BUTTON} bg-emerald-700 text-white hover:bg-emerald-800`}
                >
                  Finish checklist
                </button>
              </form>
              <form action={action}>
                <Hidden values={{ intent: "delete", eventId: event.id }} />
                <button
                  type="submit"
                  disabled={pending}
                  className={`${BUTTON} border border-zinc-300 hover:border-red-700 hover:text-red-700 dark:border-zinc-700`}
                >
                  Delete
                </button>
              </form>
            </div>
          </section>
        );
      })}

      {notStarted.length > 0 && (
        <section aria-labelledby="start-heading" className="flex flex-col gap-3">
          <h2 id="start-heading" className="text-xl font-semibold">
            Start a checklist
          </h2>
          <ul className="grid gap-3 sm:grid-cols-3">
            {notStarted.map((kind) => (
              <li
                key={kind}
                className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <h3 className="font-semibold">{LIFE_EVENTS[kind].title}</h3>
                <p className="flex-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {LIFE_EVENTS[kind].intro}
                </p>
                <form action={action}>
                  <Hidden values={{ intent: "start", kind }} />
                  <button
                    type="submit"
                    disabled={pending}
                    aria-label={`Start the ${LIFE_EVENTS[kind].title.toLowerCase()} checklist`}
                    className={`${BUTTON} border border-emerald-700 text-emerald-800 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950`}
                  >
                    Start
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {finished.length > 0 && (
        <section aria-labelledby="finished-heading" className="flex flex-col gap-2">
          <h2 id="finished-heading" className="text-xl font-semibold">
            Finished
          </h2>
          <ul className="flex flex-col gap-2">
            {finished.map((event) => {
              const checklist = LIFE_EVENTS[event.kind];
              const done = checklist.items.filter((i) => event.checkedItems.includes(i.key)).length;
              return (
                <li
                  key={event.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-4 py-2 text-sm dark:border-zinc-800"
                >
                  <span>
                    <span className="font-medium">{checklist.title}</span> · {done} of{" "}
                    {checklist.items.length} done · finished {day(event.completedAt!)}
                  </span>
                  <form action={action}>
                    <Hidden values={{ intent: "delete", eventId: event.id }} />
                    <button
                      type="submit"
                      disabled={pending}
                      aria-label={`Delete the finished ${checklist.title.toLowerCase()} checklist`}
                      className="min-h-11 px-2 text-xs text-zinc-600 hover:text-red-700 hover:underline dark:text-zinc-400"
                    >
                      Delete
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
