import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { SubmitButton } from "@/components/submit-button";
import { connectorsOn } from "@/config/connectors";
import { connectionsView, type ConsentRow } from "@/lib/connectors/consent";
import { listActions, type ActionRow } from "@/lib/connectors/pipeline";
import { momentLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { timezoneOf } from "@/lib/today";
import {
  allowConnector,
  answerConnectorAction,
  cancelConnectorAction,
  revokeConnector,
} from "./actions";

// Connections (docs/connectors.md): what each connector may do for the person, since when, and a
// way to take it back. A 404 unless CONNECTORS=1.

const MUTED = "text-sm text-zinc-600 dark:text-zinc-400";
const LINK = "font-medium underline underline-offset-2 hover:no-underline";
const BUTTON =
  "relative h-10 rounded-full bg-zinc-900 px-4 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900";

function Scopes({ scopes }: { scopes: { scope: string; label: string }[] }) {
  return (
    <ul className="list-disc pl-5 text-sm">
      {scopes.map((s) => (
        <li key={s.scope}>{s.label}</li>
      ))}
    </ul>
  );
}

function CurrentItem({ row, timezone }: { row: ConsentRow; timezone: string }) {
  return (
    <li
      data-connector={row.connectorId}
      className="flex flex-col gap-2 border-b border-zinc-200 py-3 last:border-b-0 dark:border-zinc-800"
    >
      <span className="font-medium">{row.connectorName}</span>
      <p className={MUTED}>Allowed since {momentLabel(row.grantedAt, timezone, { year: true })}</p>
      <Scopes scopes={row.scopes} />
      <form action={revokeConnector}>
        <input type="hidden" name="connectorId" value={row.connectorId} />
        <SubmitButton className={`relative inline-flex min-h-11 items-center text-sm ${LINK}`}>
          Revoke<span className="sr-only">: {row.connectorName}</span>
        </SubmitButton>
      </form>
    </li>
  );
}

const STATUS_WORDS: Record<string, string> = {
  approved: "You said yes. It runs after a short wait, and you can cancel until then.",
  running: "Running now.",
  partner_pending: "Sent. Waiting to hear back.",
  succeeded: "Done.",
  failed: "It didn't go through.",
  cancelled: "Cancelled.",
  declined: "You said no.",
  refused: "Jane stopped it before it ran.",
  reversed: "Taken back by the other side.",
};

function ActionItem({ action }: { action: ActionRow }) {
  const waiting = action.status === "awaiting_yes";
  const cancellable = action.status === "approved" || (action.cancelUntil !== null && !waiting);
  return (
    <li
      data-action={action.id}
      className="flex flex-col gap-2 border-b border-zinc-200 py-3 last:border-b-0 dark:border-zinc-800"
    >
      <span className="font-medium">{action.summary}</span>
      {action.simulated && <p className={MUTED}>Simulated: nothing real happens.</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
        {action.steps.map((step) => (
          <div key={step.label} className="contents">
            <dt className={MUTED}>{step.label}</dt>
            <dd>{step.value}</dd>
          </div>
        ))}
      </dl>
      {waiting ? (
        <form action={answerConnectorAction} className="flex flex-wrap gap-3">
          <input type="hidden" name="actionId" value={action.id} />
          <input type="hidden" name="amountCents" value={action.amountCents} />
          <input type="hidden" name="fingerprint" value={action.fingerprint} />
          <SubmitButton name="answer" value="yes" className={BUTTON}>
            Yes, {action.amountCents > 0 ? formatCents(action.amountCents) : "go ahead"}
          </SubmitButton>
          <SubmitButton name="answer" value="no" className={`relative min-h-10 text-sm ${LINK}`}>
            No
          </SubmitButton>
        </form>
      ) : (
        <p className={MUTED}>{action.note ?? STATUS_WORDS[action.status] ?? action.status}</p>
      )}
      {cancellable && (
        <form action={cancelConnectorAction}>
          <input type="hidden" name="actionId" value={action.id} />
          <SubmitButton className={`relative inline-flex min-h-11 items-center text-sm ${LINK}`}>
            Cancel<span className="sr-only">: {action.summary}</span>
          </SubmitButton>
        </form>
      )}
    </li>
  );
}

async function ConnectionsContent() {
  await connection();
  const user = await requireUser();
  const [{ available, current, past }, actions, timezone] = await Promise.all([
    connectionsView(user.id),
    listActions(user.id),
    timezoneOf(user.id),
  ]);
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Connections</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          What each connection may do for you. Jane asks for your yes on every payment, move or
          cancellation, for that exact amount. Revoke one and it stops at once.
        </p>
      </div>

      {actions.length > 0 && (
        <section aria-labelledby="actions" className="flex flex-col gap-2">
          <h2 id="actions" className="text-lg font-semibold">
            Actions
          </h2>
          <ul className="flex flex-col">
            {actions.map((action) => (
              <ActionItem key={action.id} action={action} />
            ))}
          </ul>
        </section>
      )}

      {current.length === 0 ? (
        <p className={MUTED}>You haven&apos;t allowed any connection.</p>
      ) : (
        <ul aria-label="Allowed connections" className="flex flex-col">
          {current.map((row) => (
            <CurrentItem key={row.id} row={row} timezone={timezone} />
          ))}
        </ul>
      )}

      {available.length > 0 && (
        <section aria-labelledby="available" className="flex flex-col gap-3">
          <h2 id="available" className="text-lg font-semibold">
            Available
          </h2>
          {available.map((c) => (
            <form key={c.id} action={allowConnector} className="flex flex-col gap-2">
              <input type="hidden" name="connectorId" value={c.id} />
              <span className="font-medium">{c.name}</span>
              <Scopes scopes={c.scopes} />
              {c.scopes.map((s) => (
                <input key={s.scope} type="hidden" name="scope" value={s.scope} />
              ))}
              <SubmitButton className={`self-start ${BUTTON}`}>
                Allow<span className="sr-only">: {c.name}</span>
              </SubmitButton>
            </form>
          ))}
        </section>
      )}

      {past.length > 0 && (
        <section aria-labelledby="past" className="flex flex-col gap-2">
          <h2 id="past" className="text-lg font-semibold">
            Revoked
          </h2>
          <ul className="flex flex-col gap-1">
            {past.map((row) => (
              <li key={row.id} className={MUTED}>
                {row.connectorName}: allowed {momentLabel(row.grantedAt, timezone, { year: true })},
                revoked {row.revokedAt && momentLabel(row.revokedAt, timezone, { year: true })}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link href="/settings" className={`self-start ${LINK}`}>
        Back to settings
      </Link>
    </>
  );
}

export default function ConnectionsPage() {
  if (!connectorsOn()) notFound();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading label="Loading your connections" />}>
        <ConnectionsContent />
      </Suspense>
    </main>
  );
}
