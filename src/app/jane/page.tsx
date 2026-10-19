import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { scopedDb } from "@/lib/db-scoped";
import { lastControllerRun } from "@/lib/controller-log";
import { loadJaneHub } from "@/lib/hubs/jane";
import { rankedFor } from "@/lib/jane-agent/priorities";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { TOP_THINGS } from "@/config/priorities";
import { checkedLine } from "@/lib/jane-agent/replies-checked";
import { changeLine, scoreLine } from "@/lib/jane-agent/replies-health";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

// The Jane hub (spec step 80): everything Jane found and is doing, each list a short
// summary of its full page.

const LINK = "font-medium text-emerald-700 hover:underline";
const ROW = "flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";
const MUTED = "text-zinc-600 dark:text-zinc-400";

function Section({
  title,
  links,
  children,
  id,
}: {
  title: string;
  links: { href: string; label: string }[];
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-xl font-semibold">{title}</h2>
        <span className="flex flex-wrap gap-x-4 text-sm">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={LINK}>
              {l.label}
            </Link>
          ))}
        </span>
      </div>
      {children}
    </section>
  );
}

async function JaneContent() {
  const user = await requireUser();
  await connection();
  const db = await scopedDb();
  const [hub, accounts, lastRun, snapshot] = await Promise.all([
    loadJaneHub(user.id),
    db.accounts.count(),
    lastControllerRun(user.id),
    loadSnapshot(user.id),
  ]);
  // Spec step 143: the one to three things that matter most, and why.
  const top = snapshot ? rankedFor(snapshot).slice(0, TOP_THINGS) : [];
  const { decide, inProgress, done, alerts } = hub;

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">What Jane is doing for you</h1>
        <p className={MUTED}>
          What&apos;s waiting for your answer, what Jane and our team are working on, and
          what&apos;s done.
        </p>
      </div>

      {top.length > 0 && (
        <Section title="The next best things" links={[]}>
          <ol className="flex flex-col gap-2">
            {top.map((r) => (
              <li key={r.key} className={ROW}>
                <Link href={r.href} className={LINK}>
                  {r.title}
                </Link>
                <span className={`text-sm ${MUTED}`}>{r.why}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {snapshot?.health && (
        // Spec step 146: the money health score, every part explained.
        <Section title="Money health" links={[]} id="health">
          <p>
            {scoreLine(snapshot.health)} {changeLine(snapshot.health)}
          </p>
          <ul className="flex flex-col gap-2">
            {snapshot.health.parts.map((p) => (
              <li key={p.part} className={ROW}>
                <span className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="font-semibold">{p.label}</span>
                  <span className={`text-sm ${MUTED}`}>
                    {p.points} of {p.max}
                  </span>
                </span>
                <span className={`text-sm ${MUTED}`}>{p.why}</span>
                {p.next && <span className="text-sm text-emerald-700">{p.next}</span>}
              </li>
            ))}
          </ul>
          {snapshot.health.left.length > 0 && (
            <p className={`text-sm ${MUTED}`}>
              Not counted yet: {snapshot.health.left.map((l) => `${l.label} (${l.why})`).join(" ")}
            </p>
          )}
          <p className={`text-sm ${MUTED}`}>
            Each part&apos;s weight is set in advance, and parts Jane can&apos;t see yet are left
            out rather than counted against you.
          </p>
        </Section>
      )}

      <Section
        title="To decide"
        links={[
          { href: "/plan", label: "See the full plan" },
          { href: "/report", label: "All findings" },
        ]}
      >
        {decide.items.length === 0 ? (
          <p className={MUTED}>
            {accounts === 0 ? (
              <>
                Nothing to decide yet.{" "}
                <Link href="/connect" className={LINK}>
                  Link a bank
                </Link>{" "}
                and Jane will look for money you&apos;re losing.
              </>
            ) : (
              "Nothing to decide right now. Jane keeps watching and adds to your plan when it finds something."
            )}
          </p>
        ) : (
          <>
            <p className={MUTED}>
              {decide.total} {decide.total === 1 ? "thing" : "things"} to look at
              {decide.totalSavingsCents > 0
                ? `, worth up to about ${formatCents(decide.totalSavingsCents)} a year`
                : ""}
              . Nothing changes until you say yes.
            </p>
            <ul className="flex flex-col gap-3">
              {decide.items.map((item) => (
                <li key={item.findingId}>
                  <Link
                    href={`/report/${item.findingId}`}
                    className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 p-4 [overflow-wrap:anywhere] hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                  >
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="font-semibold">{item.title}</span>
                      <span className={`text-sm ${MUTED}`}>{item.savings}</span>
                      {item.pick && <span className="text-sm text-emerald-700">{item.pick}</span>}
                    </span>
                    <span aria-hidden className="text-zinc-400">
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section title="In progress" links={[{ href: "/actions", label: "See all" }]}>
        {inProgress.items.length === 0 ? (
          <p className={MUTED}>
            Nothing underway. When you say yes to something, Jane and our team get to work and you
            can follow along here.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {inProgress.items.map((a) => (
              <li key={a.id} className={`${ROW} [overflow-wrap:anywhere]`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="font-semibold">{a.title}</span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${a.status === "waiting_on_user" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}
                  >
                    {a.label}
                  </span>
                </div>
                {a.todo && (
                  <p className="rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950">
                    <strong>What we need from you:</strong> {a.todo}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {inProgress.total > inProgress.items.length && (
          <p className={`text-sm ${MUTED}`}>
            And {inProgress.total - inProgress.items.length} more on{" "}
            <Link href="/actions" className={LINK}>
              your actions
            </Link>
            .
          </p>
        )}
      </Section>

      <Section
        title="Done"
        links={[
          { href: "/actions", label: "See all" },
          { href: "/saved", label: "What Jane saved you" },
        ]}
      >
        {done.savedToDateCents > 0 && (
          <p className="text-lg">
            Saved so far: <strong>{formatCents(done.savedToDateCents)}</strong>
          </p>
        )}
        {done.items.length === 0 ? (
          <p className={MUTED}>
            Nothing finished yet. What Jane gets done, and what it saved you, shows up here.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {done.items.map((a) => (
              <li key={a.id} className={`${ROW} [overflow-wrap:anywhere]`}>
                <span className="font-semibold">{a.title}</span>
                {a.saving && <span className={`text-sm ${MUTED}`}>{a.saving}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Spec step 142: the nightly controller run, one line per sector. */}
      <Section title="What I checked last night" links={[]}>
        {lastRun ? (
          <ul className="flex flex-col gap-1 text-sm">
            {lastRun.steps.map((s) => (
              <li key={s.step}>
                {checkedLine(s)}
                {s.changed > 0 ? <span className={MUTED}> · {s.changed} changed</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className={MUTED}>Jane checks everything every night. The first run shows here.</p>
        )}
      </Section>

      <Section title="Alerts" links={[{ href: "/alerts", label: "See all" }]}>
        {alerts.items.length === 0 ? (
          <p className={MUTED}>No new alerts. Jane tells you here when something needs a look.</p>
        ) : (
          <>
            <p className={MUTED}>
              {alerts.unread} new {alerts.unread === 1 ? "alert" : "alerts"}.
            </p>
            <ul className="flex flex-col gap-3">
              {alerts.items.map((a) => (
                <li key={a.id} className={`${ROW} [overflow-wrap:anywhere]`}>
                  <span className="font-semibold">{a.title}</span>
                  <span className={`text-sm ${MUTED}`}>{a.body}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
    </>
  );
}

export default function JanePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <JaneContent />
      </Suspense>
    </main>
  );
}
