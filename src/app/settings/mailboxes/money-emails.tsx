import { GMAIL_LIMITS, type GmailKind } from "@/config/gmail";
import { dayLabel, momentLabel } from "@/lib/day-label";
import type { ReadingView } from "@/lib/gmail/mailbox";
import { formatCents } from "@/lib/money";

// "Money emails Jane read" on /settings/mailboxes: what Claude picked out of each email (a kind, an
// amount, a day) beside the domain Google checked it came from. No text from an email is shown, so
// a hostile one can at most be listed as a kind, an amount written in it and a day. Every row is
// the person's own data, so it is marked private.

const MUTED = "text-sm text-zinc-600 dark:text-zinc-400";
const LINK = "font-medium underline underline-offset-2 hover:no-underline";

// Each kind in plain words, and what its day is.
const KINDS: Record<GmailKind, { label: string; day: string }> = {
  receipt: { label: "Receipt", day: "Paid" },
  bill: { label: "Bill", day: "Due" },
  renewal: { label: "Renewal", day: "Renews" },
  price_change: { label: "Price change", day: "Changes" },
  refund: { label: "Refund", day: "Refunded" },
};

function Reading({
  reading,
  several,
  timezone,
}: {
  reading: ReadingView;
  several: boolean;
  timezone: string;
}) {
  const kind = reading.kind === null ? null : KINDS[reading.kind];
  // The day is a calendar day; when it arrived is a moment, so the person's own day.
  const day = reading.occursOn === null ? null : dayLabel(reading.occursOn);
  const facts = [
    kind?.label ?? "Other",
    day && (kind ? `${kind.day} ${day}` : day),
    `Arrived ${momentLabel(reading.receivedAt, timezone)}`,
    several ? reading.mailbox : null,
  ].filter((fact) => fact !== null);
  return (
    <li
      data-private
      className="flex flex-col gap-1 border-b border-zinc-200 py-3 last:border-b-0 dark:border-zinc-800"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium [overflow-wrap:anywhere]">{reading.senderDomain}</span>
        {reading.amountCents !== null && (
          <span className="text-sm font-semibold tabular-nums">
            {formatCents(reading.amountCents)}
          </span>
        )}
      </div>
      <p className={`${MUTED} [overflow-wrap:anywhere]`}>{facts.join(" · ")}</p>
    </li>
  );
}

export function MoneyEmails({
  readings,
  more,
  stillReading,
  beingRead,
  several,
  timezone,
}: {
  readings: ReadingView[];
  more: boolean;
  // A mailbox's first read is still under way.
  stillReading: boolean;
  // Jane reads one of these mailboxes now: one is connected, and reading isn't paused or off. A
  // mailbox Google stopped accepting, or that another Jane account connected since, isn't read.
  beingRead: boolean;
  // The person has more than one mailbox, so each row says which it was read in.
  several: boolean;
  timezone: string;
}) {
  return (
    <section aria-labelledby="money-emails" className="flex flex-col gap-2">
      <h2 id="money-emails" className="text-lg font-semibold">
        Money emails Jane read
      </h2>
      <p className={MUTED}>
        Read by AI from your email. It can be wrong and it can miss emails. Jane shows what each
        email says and the domain it really came from. It can&apos;t tell whether the email is
        honest, so if you don&apos;t recognize one, don&apos;t pay or call from it.
      </p>
      {readings.length === 0 ? (
        <p className={MUTED}>
          {stillReading
            ? "Nothing yet. Jane is still reading."
            : beingRead
              ? "Nothing found yet. New emails about your money will show here after Jane reads them."
              : "Nothing here. Jane isn't reading any of these mailboxes right now."}
        </p>
      ) : (
        <ul aria-labelledby="money-emails" className="flex flex-col">
          {readings.map((reading) => (
            <Reading key={reading.id} reading={reading} several={several} timezone={timezone} />
          ))}
        </ul>
      )}
      {more && (
        <p className={MUTED}>
          Showing the newest {GMAIL_LIMITS.shownReadings}. The rest are in{" "}
          <a href="/api/export" download className={LINK}>
            Download my data
          </a>
          .
        </p>
      )}
    </section>
  );
}
