import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AppHeader } from "@/components/app-header";
import { PageShell } from "@/components/page-shell";
import { GMAIL_LIMITS, gmailOffered, gmailOpen } from "@/config/gmail";
import { GMAIL_CONSENT, gmailDisclosure } from "@/config/gmail-disclosure";
import { sessionTokenFrom } from "@/lib/admin-gate";
import { momentLabel } from "@/lib/day-label";
import { makeTicket } from "@/lib/gmail/connect-ticket";
import { readerReady } from "@/lib/gmail/limits";
import { mailboxesView, readingsView, whyCantConnect, type MailboxView } from "@/lib/gmail/mailbox";
import { NOTICE_COOKIE, openNotice, type NoticeWord } from "@/lib/gmail/notice";
import { gmailSetUp } from "@/lib/gmail/oauth";
import { momentTimeLabel } from "@/lib/moment-time";
import { requireUser } from "@/lib/session";
import { timezoneOf } from "@/lib/today";
import { MailboxItem } from "./mailbox-item";
import { MoneyEmails } from "./money-emails";

// Gmail mailboxes (docs/setup/gmail.md, src/lib/gmail/): what connecting one does, the Connect
// link, what Jane is doing with each mailbox, the money emails it read, and Disconnect. What just
// happened comes from a cookie only the server makes (src/lib/gmail/notice.ts), never from the
// address bar. The render only reads: making the Connect link's ticket writes nothing, and nothing
// is counted, logged or started. A 404 only while Gmail isn't offered, the person has no mailbox
// and there is nothing to say: one connected before the switch went off is still listed, with
// Disconnect, and disconnecting the last one still says what happened.

const MUTED = "text-sm text-zinc-600 dark:text-zinc-400";
const LINK = "font-medium underline underline-offset-2 hover:no-underline";
// The page's one primary action: the text colour as its background.
const CONNECT =
  "inline-flex min-h-11 w-fit items-center bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const TOO_MANY = `You've connected ${GMAIL_LIMITS.mailboxesMost} mailboxes, the most Jane reads for one person. Disconnect one to add another.`;

// What a connect or a disconnect sent the person back to say, once.
const NOTICES: Record<NoticeWord, string> = {
  connected: "Connected.",
  connected_moved:
    "Connected. This mailbox was connected to another Jane account until now; Jane has stopped reading it there.",
  not_connected:
    "That mailbox wasn't connected. You can try again. If Google now lists Jane under the apps with access to your account, you can remove it there.",
  not_allowed:
    "Google didn't give Jane permission to read that mailbox, so it wasn't connected. You can try again.",
  paused: "Connecting is paused for now. Please try again later.",
  too_many: TOO_MANY,
  start_here:
    "That link didn't start anything. Before you connect a mailbox, check the account named below.",
  disconnected:
    "Disconnected. Jane deleted what it read from that mailbox, and Google ended Jane's permission.",
  disconnected_unconfirmed:
    "Disconnected. Jane deleted its own access and what it read from that mailbox. Google didn't confirm that it ended Jane's permission. To be sure, open your Google Account, find Jane under the apps with access, and remove it.",
  disconnected_no_access:
    "Disconnected. Jane had already lost its access, and has deleted what it read from that mailbox.",
};

// One line for each mailbox: the first that applies, in this order.
const SWITCHED_OFF =
  "Mailboxes are switched off for now. Jane isn't reading this mailbox. Disconnect to delete what Jane read from it.";
const ELSEWHERE =
  "This mailbox is now connected to a different Jane account, so Jane stopped reading it here. What Jane read before is still listed below. If that wasn't you, connect it again, or remove Jane in your Google Account.";
const RECONNECT =
  "Google stopped accepting this connection, so Jane isn't reading this mailbox. That happens when you change your Google password or take back Jane's permission. What Jane read before is still listed below. Connect it again to carry on, or disconnect to delete it.";
const PAUSED = "Reading is paused for now.";
const FIRST_READ = `Reading your newest emails from the last ${GMAIL_LIMITS.lookBackDays} days. This takes a minute or two. Come back to this page to see what Jane read.`;
const NEVER_READ = "Jane hasn't been able to read this mailbox yet. It will try again by itself.";

type Context = {
  offered: boolean;
  open: boolean;
  // Whether Claude may be asked for this person's mail now (src/lib/gmail/limits.ts).
  readerOk: boolean;
  now: Date;
  timezone: string;
};

function stateLine(mailbox: MailboxView, { offered, open, readerOk, now, timezone }: Context) {
  // First: the lines below ask for a connection, and none can be made with the switch off.
  if (!offered) return SWITCHED_OFF;
  if (mailbox.status === "elsewhere") return ELSEWHERE;
  if (mailbox.status === "reconnect") return RECONNECT;
  // Not one of the three words (only a row a test planted holds another): nothing reads it.
  if (mailbox.status === null) return NEVER_READ;
  if (!open) return PAUSED;
  if (mailbox.lastCheckedAt === null) {
    // Timed from when they last connected it, since connecting again keeps createdAt. While Claude
    // can't be asked, a read stops before it reads anything (src/lib/gmail/sync.ts), so nothing is
    // under way.
    const justNow =
      now.getTime() - mailbox.agreedAt.getTime() < GMAIL_LIMITS.firstReadMinutes * MINUTE;
    return justNow && readerOk ? FIRST_READ : NEVER_READ;
  }
  const time = momentTimeLabel(mailbox.lastCheckedAt, timezone);
  if (!readerOk) {
    return `Jane isn't reading new email right now. It will carry on by itself. Last read ${time}.`;
  }
  // A watch that failed doesn't stop reading: only how soon new email is read changes.
  if (mailbox.lastErrorCode !== null && mailbox.lastErrorCode !== "watch_failed") {
    return `The last read didn't work; Jane will try again. Last checked ${time}.`;
  }
  return mailbox.watchExpiresAt !== null && mailbox.watchExpiresAt > now
    ? `Reading new email as it arrives. Last checked ${time}.`
    : `Reading new email once a day. Last checked ${time}.`;
}

// After reading lost its place and skipped ahead, for a while.
function missedLine(mailbox: MailboxView, now: Date, timezone: string): string | null {
  const at = mailbox.missedAt;
  if (at === null || now.getTime() - at.getTime() >= GMAIL_LIMITS.missedShownDays * DAY)
    return null;
  return `Jane couldn't read this mailbox for a while, so some emails before ${momentLabel(at, timezone)} weren't read.`;
}

// Whether the Connect link shows, and the line beside it or instead of it: the first that applies.
function connectState(
  mailboxes: MailboxView[],
  why: "trial" | "demo" | null,
): { link: boolean; line: string | null } {
  if (!gmailSetUp()) return { link: false, line: "Connecting isn't set up yet." };
  if (why !== null) return { link: false, line: "A sample account can't connect a mailbox." };
  if (!gmailOpen()) {
    return {
      link: false,
      line: "Reading is paused for now. Jane isn't reading any mailbox. You can still disconnect.",
    };
  }
  if (mailboxes.length < GMAIL_LIMITS.mailboxesMost) return { link: true, line: null };
  // At the cap a mailbox listed below can still be connected again: that adds no new one.
  return mailboxes.some((m) => m.status === "reconnect" || m.status === "elsewhere")
    ? {
        link: true,
        line: "You can connect again a mailbox listed below. To add another, disconnect one first.",
      }
    : { link: false, line: TOO_MANY };
}

async function MailboxesContent() {
  await connection();
  const user = await requireUser();
  const offered = gmailOffered();
  const [mailboxes, jar] = await Promise.all([mailboxesView(user.id), cookies()]);
  const now = new Date();
  const word = openNotice(jar.get(NOTICE_COOKIE)?.value, user.id, now);
  const active = mailboxes.some((m) => m.status === "active");
  // "Connected" is said only while one is.
  const connectedWord = word === "connected" || word === "connected_moved";
  const said = word !== null && (active || !connectedWord) ? NOTICES[word] : null;
  // With the switch off the page stays for a mailbox still connected, or to say once what a
  // Disconnect just did: the routes answer 404 then, so only Disconnect leaves a word.
  if (!offered && mailboxes.length === 0 && said === null) notFound();
  const open = gmailOpen();
  // Asked only for an active mailbox, whose line can depend on it.
  const askReader = open && active;
  const [{ readings, more }, timezone, why, reader] = await Promise.all([
    readingsView(user.id),
    timezoneOf(user.id),
    offered ? whyCantConnect(user.id) : null,
    askReader ? readerReady(user.id) : null,
  ]);

  const connect = offered ? connectState(mailboxes, why) : { link: false, line: null };
  // At the most mailboxes the line by the Connect part says this already: once is enough.
  const shown = word === "too_many" && connect.line === TOO_MANY ? null : said;
  // Tied to this browser's session (src/lib/gmail/connect-ticket.ts): the connect route goes on
  // only with it, so a link someone else sent can't lead straight to Google's page.
  const token = sessionTokenFrom(jar);
  const ticket = connect.link && token ? makeTicket(user.id, token, now) : null;

  const context = { offered, open, readerOk: reader?.ok ?? true, now, timezone };
  const rows = mailboxes.map((mailbox) => ({
    mailbox,
    line: stateLine(mailbox, context),
    missed: missedLine(mailbox, now, timezone),
  }));

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Mailboxes</h1>
        {shown && (
          <p role="status" className="font-medium">
            {shown}
          </p>
        )}
        {offered && (
          <p className="text-zinc-600 dark:text-zinc-400">
            You&apos;re signed in to Jane as{" "}
            <span data-private className="font-medium [overflow-wrap:anywhere]">
              {user.email}
            </span>
            . A mailbox you connect is added to this account.
          </p>
        )}
      </div>

      {offered && (
        <section aria-labelledby="before-you-connect" className="flex flex-col gap-3">
          <h2 id="before-you-connect" className="text-lg font-semibold">
            Before you connect
          </h2>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {gmailDisclosure().map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
          {ticket ? (
            <>
              <p className="text-sm">{GMAIL_CONSENT}</p>
              {connect.line && <p className="text-sm">{connect.line}</p>}
              {/* A link, not a form: the site's security policy stops a form going on to Google. */}
              <a
                href={`/api/gmail/connect?ticket=${encodeURIComponent(ticket)}`}
                className={CONNECT}
              >
                Agree and connect a Gmail mailbox
              </a>
            </>
          ) : (
            connect.line && <p className="text-sm font-medium">{connect.line}</p>
          )}
        </section>
      )}

      {rows.length > 0 && (
        <section aria-labelledby="your-mailboxes" className="flex flex-col gap-2">
          <h2 id="your-mailboxes" className="text-lg font-semibold">
            Your mailboxes
          </h2>
          <ul aria-labelledby="your-mailboxes" className="flex flex-col">
            {rows.map(({ mailbox, line, missed }) => (
              <MailboxItem
                key={mailbox.id}
                id={mailbox.id}
                address={mailbox.address}
                line={line}
                missed={missed}
                hasAccess={mailbox.status === "active"}
              />
            ))}
          </ul>
        </section>
      )}

      {rows.length > 0 && (offered || readings.length > 0) && (
        <MoneyEmails
          readings={readings}
          more={more}
          stillReading={rows.some((row) => row.line === FIRST_READ)}
          several={mailboxes.length > 1}
          timezone={timezone}
        />
      )}

      {offered && (
        <p className={MUTED}>
          Use iCloud, Outlook or another mailbox? You can set it to forward everything to a Gmail
          mailbox you connect here. That puts a copy of all its email in Gmail. Jane only reads a
          forwarded email when Google can still confirm which company sent it, so some will be
          missed.
        </p>
      )}

      <Link href="/settings" className={`self-start ${LINK}`}>
        Back to settings
      </Link>
    </>
  );
}

export default function MailboxesPage() {
  return (
    <PageShell label="Loading your mailboxes">
      <MailboxesContent />
    </PageShell>
  );
}

// Never kept in the browser's memory (src/lib/page-cache.ts). It follows a connect or a
// disconnect, and the reads behind it change what it says.
export const unstable_dynamicStaleTime = 0;
