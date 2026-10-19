import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { ALERT_EMAILS_PER_DAY, ALERT_LABELS, ALERT_TYPES } from "@/config/alerts";
import { DEFAULT_TIMEZONE, TIMEZONES } from "@/config/digest";
import { alertPrefs, isUrgent } from "@/lib/alerts";
import { twoFactorStatus } from "@/lib/mfa";
import { rulesFor } from "@/lib/standing-rules";
import { autopilotOf } from "@/lib/autopilot";
import { AUTOPILOT_LEVELS } from "@/config/autopilot";
import { AutopilotChooser } from "@/components/autopilot-chooser";
import { CallOffersForm } from "./call-offers-form";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scoped";
import { requireUser } from "@/lib/session";
import { formatCents } from "@/lib/money";
import { vapidPublicKey } from "@/lib/push";
import { US_STATES } from "@/config/referrals";
import { AlertsForm } from "./alerts-form";
import { CalendarForm } from "./calendar-form";
import { StateForm } from "./state-form";
import { NotificationsToggle } from "./notifications";
import { DeleteDataForm, DisconnectForm, RefreshForm } from "./data-forms";
import { EmailForm } from "./email-form";
import { TwoFactorOnForms } from "./two-factor-forms";
import { RulesForm } from "./rules-form";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { sessionTokenFrom } from "@/lib/admin-gate";
import { listSessions } from "@/lib/user-sessions";
import { SessionsList } from "./sessions-list";
import {
  CHAT_NOTIFY_DAILY_LIMIT,
  CHAT_NOTIFY_KIND_LABELS,
  CHAT_NOTIFY_KINDS,
} from "@/config/chat-notify";
import { QUIET_END_HOUR, QUIET_START_HOUR } from "@/config/agent-chat";
import { chatNotifyPrefs } from "@/lib/jane-agent/notify-prefs";
import { ChatNotifyForm } from "./chat-notify-form";
import { listPreferences } from "@/lib/jane-agent/preferences";
import { MemoryList } from "./memory-list";
import { SECTOR_ALL_MEANS, SECTOR_LABELS } from "@/config/autopilot-sectors";
import { sectorAutopilots } from "@/lib/sector-autopilot";
import { SectorsForm } from "./sectors-form";

// "9pm", "8am".
const clock = (hour: number) => `${hour % 12 || 12}${hour < 12 ? "am" : "pm"}`;

// Spec step 79: the sections sit in four groups, with a menu of them at the top. Each
// section keeps its id (#banks, #alerts, #autopilot, #rules, #two-factor, ...): other
// pages and emails link straight to them.
const GROUPS = [
  { id: "accounts", label: "Accounts" },
  { id: "notifications", label: "Notifications" },
  { id: "autopilot", label: "Autopilot" },
  { id: "privacy", label: "Privacy and security" },
] as const;

const H2 = "text-2xl font-semibold tracking-tight";
const H3 = "text-lg font-semibold";
const GROUP = "flex scroll-mt-8 flex-col gap-8 border-t border-zinc-200 pt-6 dark:border-zinc-800";
const SECTION = "flex scroll-mt-8 flex-col gap-3";
const MUTED = "text-zinc-600 dark:text-zinc-400";
const LINK = "font-medium text-emerald-700 hover:underline";

function Group({ id, children }: { id: (typeof GROUPS)[number]["id"]; children: ReactNode }) {
  const label = GROUPS.find((g) => g.id === id)?.label;
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className={GROUP}>
      <h2 id={`${id}-heading`} className={H2}>
        {label}
      </h2>
      {children}
    </section>
  );
}

// Where you're signed in (spec step 73). This session is found by its cookie, here on the
// server; the page only ever gets row ids and labels.
async function SessionsSection({ userId }: { userId: string }) {
  await connection();
  const sessions = await listSessions(userId, sessionTokenFrom(await cookies()));
  return (
    <section id="sessions" className="flex scroll-mt-8 flex-col gap-3">
      <h3 className={H3}>Where you&apos;re signed in</h3>
      <p className="text-zinc-600 dark:text-zinc-400">
        Don&apos;t recognize one? Sign it out; it stops working straight away.
      </p>
      <SessionsList sessions={sessions} />
    </section>
  );
}

async function SettingsContent() {
  const user = await requireUser();
  const mine = await scopedDb();
  const [prefs, items, accounts, lastCsv, twoFactor, rules, autopilot, remembered, sectors] =
    await Promise.all([
      db.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          digestEnabled: true,
          timezone: true,
          alertPrefs: true,
          state: true,
          calendarCreatedAt: true,
          acceptSimpleOffers: true,
          chatNotifyPrefs: true,
        },
      }),
      mine.plaidItems.findMany({
        select: {
          id: true,
          institutionName: true,
          lastSyncedAt: true,
          accounts: { select: { name: true, mask: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      mine.accounts.findMany({
        select: {
          id: true,
          name: true,
          mask: true,
          source: true,
          type: true,
          currentBalanceCents: true,
          item: { select: { lastSyncedAt: true, institutionName: true } },
        },
        orderBy: [{ source: "asc" }, { name: "asc" }],
      }),
      // The newest CSV row per account: when that account was last imported.
      mine.transactions.findMany({
        where: { source: "csv" },
        distinct: ["accountId"],
        orderBy: [{ accountId: "asc" }, { createdAt: "desc" }],
        select: { accountId: true, createdAt: true },
      }),
      twoFactorStatus(user.id),
      rulesFor(user.id),
      autopilotOf(user.id),
      listPreferences(user.id),
      sectorAutopilots(user.id),
    ]);
  const csvUpdated = new Map(lastCsv.map((row) => [row.accountId, row.createdAt]));
  const alerts = alertPrefs(prefs.alertPrefs);
  const chatNotify = chatNotifyPrefs(prefs.chatNotifyPrefs);
  const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "not yet");

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <nav aria-label="Settings sections">
          <ul className="flex flex-wrap gap-2 text-sm">
            {GROUPS.map((group) => (
              <li key={group.id}>
                <a
                  href={`#${group.id}`}
                  className="inline-flex h-11 items-center rounded-full border border-zinc-300 px-4 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  {group.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <Group id="accounts">
        <section id="banks" className={SECTION}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className={H3}>Connected banks</h3>
            <Link href="/connect" className={`text-sm ${LINK}`}>
              Add a bank or import a file
            </Link>
          </div>
          {items.length === 0 ? (
            <p className={MUTED}>No banks linked.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 sm:flex-row sm:items-start sm:justify-between dark:border-zinc-800"
                >
                  <div>
                    <p className="font-semibold">{item.institutionName ?? "Your bank"}</p>
                    <p className="text-xs text-zinc-500">Updated {day(item.lastSyncedAt)}</p>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      {item.accounts
                        .map((a) => (a.mask ? `${a.name} ····${a.mask}` : a.name))
                        .join(", ")}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <RefreshForm itemId={item.id} />
                    <DisconnectForm itemId={item.id} name={item.institutionName ?? "this bank"} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {accounts.length > 0 && (
          <section id="your-accounts" className={SECTION}>
            <h3 className={H3}>Your accounts</h3>
            <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
              {accounts.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 px-4 py-3">
                  <span>
                    <span className="font-medium">
                      {a.mask ? `${a.name} ····${a.mask}` : a.name}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {a.source === "plaid"
                        ? `Linked through ${a.item?.institutionName ?? "Plaid"} · updated ${day(a.item?.lastSyncedAt)}`
                        : `CSV import · last import ${day(csvUpdated.get(a.id))}`}
                    </span>
                  </span>
                  <span className="font-medium">
                    {a.currentBalanceCents === null
                      ? "No balance"
                      : formatCents(a.currentBalanceCents)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section id="household" className={SECTION}>
          <h3 className={H3}>Household</h3>
          <p className={MUTED}>
            Share chosen accounts with a partner, read-only.{" "}
            <Link href="/household" className={LINK}>
              Manage your household
            </Link>
          </p>
        </section>

        <section id="where-you-live" className={SECTION}>
          <h3 className={H3}>Where you live</h3>
          <p className={MUTED}>
            Some offers (like savings accounts from partners) are only available in some states.
          </p>
          <StateForm state={prefs.state} states={US_STATES} />
        </section>
      </Group>

      <Group id="notifications">
        {/* Spec step 85: Jane's chat messages as phone notifications or email. */}
        <section id="jane-messages" className={SECTION}>
          <h3 className={H3}>Messages from Jane</h3>
          <p className={MUTED}>
            When I post something important in your chat, I can send it to you, with buttons to
            answer right there. At most {CHAT_NOTIFY_DAILY_LIMIT} a day, never between{" "}
            {clock(QUIET_START_HOUR)} and {clock(QUIET_END_HOUR)}, and never something you&apos;ve
            already seen.
          </p>
          <ChatNotifyForm
            channel={chatNotify.channel}
            kinds={CHAT_NOTIFY_KINDS.map((kind) => ({
              kind,
              label: CHAT_NOTIFY_KIND_LABELS[kind],
              on: chatNotify.kinds[kind],
            }))}
          />
        </section>

        <section id="email" className={SECTION}>
          <h3 className={H3}>Email</h3>
          <EmailForm
            digestEnabled={prefs.digestEnabled}
            timezone={prefs.timezone ?? DEFAULT_TIMEZONE}
            timezones={TIMEZONES}
          />
        </section>

        <section id="alerts" className={SECTION}>
          <h3 className={H3}>Alerts</h3>
          <p className={MUTED}>
            We check for these after every update from your bank. Emails right away are limited to{" "}
            {ALERT_EMAILS_PER_DAY} a day; anything else waits for the weekly email.
          </p>
          <AlertsForm
            rows={ALERT_TYPES.map((type) => ({
              type,
              ...ALERT_LABELS[type],
              urgent: isUrgent(type),
              value: alerts[type],
            }))}
          />
          {vapidPublicKey() && <NotificationsToggle publicKey={vapidPublicKey() ?? ""} />}
        </section>
      </Group>

      {/* The group is #autopilot, so links to it land on its heading. */}
      <Group id="autopilot">
        <section className={SECTION}>
          <p className={MUTED}>
            How much Jane does on its own. Now:{" "}
            <strong>
              {autopilot === null
                ? "not chosen yet"
                : autopilot === "custom"
                  ? "your own rules (below)"
                  : AUTOPILOT_LEVELS[autopilot].label}
            </strong>
            . Pick a level to change it.
          </p>
          <AutopilotChooser compact />
          <CallOffersForm accept={prefs.acceptSimpleOffers} />
        </section>

        <section id="sectors" className={SECTION}>
          <h3 className={H3}>Area by area</h3>
          <p className={MUTED}>
            How much Jane may do by herself in each area, and up to how many dollars each time and
            each month. Over a cap, she asks. Free checks (reshopping, rate checks) run in every
            area.
          </p>
          <SectorsForm
            rows={sectors.map((s) => ({
              sector: s.sector,
              label: SECTOR_LABELS[s.sector],
              level: s.level,
              actionCap: String(s.actionCapCents / 100),
              monthlyCap: String(s.monthlyCapCents / 100),
              used: formatCents(s.usedThisMonthCents),
              allMeans: SECTOR_ALL_MEANS[s.sector],
            }))}
          />
        </section>

        <section id="rules" className={SECTION}>
          <h3 className={H3}>Fine-tune: standing rules</h3>
          <p className={MUTED}>
            Things Jane may do without asking each time. Jane tells you whenever a rule is used, and
            you can take it back for a day. Moving money, phone calls, cancelling things and
            insurance always need your yes.
          </p>
          <RulesForm
            rules={rules.map((r) => ({
              key: r.key,
              label: r.label,
              description: r.description,
              enabled: r.enabled,
              monthlyLimit: r.monthlyLimit,
              maxAmountLabel: r.maxAmount?.label ?? null,
              maxDollars: r.maxAnnualCents === null ? "" : String(r.maxAnnualCents / 100),
            }))}
          />
        </section>

        {/* Spec step 91: what Jane remembers, each one deletable. */}
        <section id="remembers" className={SECTION}>
          <h3 className={H3}>What Jane remembers</h3>
          <p className={MUTED}>
            What you&apos;ve told Jane in the chat, and suggestions you asked her not to make again.
            She uses these in her answers and suggestions.
          </p>
          <MemoryList preferences={remembered} />
        </section>
      </Group>

      <Group id="privacy">
        <section id="two-factor" className={SECTION}>
          <h3 className={H3}>Two-factor sign-in</h3>
          {twoFactor.enabledAt ? (
            <>
              <p className={MUTED}>
                On since {day(twoFactor.enabledAt)}. Each new sign-in asks for a code from your
                authenticator app. {twoFactor.backupCodesLeft} backup{" "}
                {twoFactor.backupCodesLeft === 1 ? "code" : "codes"} left.
              </p>
              <TwoFactorOnForms canTurnOff={user.role !== "admin"} />
            </>
          ) : (
            <>
              <p className={MUTED}>
                Optional extra protection: after the email link or Google, signing in also asks for
                a code from an app on your phone.
              </p>
              <Link
                href="/settings/two-factor"
                className="inline-flex h-11 w-fit items-center justify-center rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800"
              >
                Turn on two-factor
              </Link>
            </>
          )}
        </section>

        <SessionsSection userId={user.id} />

        <section id="team-access" className={SECTION}>
          <h3 className={H3}>Who saw my data</h3>
          <p className={MUTED}>
            Every time our team or Jane&apos;s agent looked at or acted on your data.{" "}
            <Link href="/settings/team-access" className={LINK}>
              See who saw my data
            </Link>
          </p>
        </section>

        <section id="calendar" className={SECTION}>
          <h3 className={H3}>Money calendar</h3>
          <CalendarForm since={prefs.calendarCreatedAt?.toISOString().slice(0, 10) ?? null} />
        </section>

        <section id="your-data" className={SECTION}>
          <h3 className={H3}>Your data</h3>
          <p className={MUTED}>Download a copy of everything we hold about you, as a JSON file.</p>
          <a
            href="/api/export"
            download
            className="inline-flex h-11 items-center justify-center self-start rounded-full border border-zinc-300 px-5 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Download my data
          </a>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Uploaded policies, warranties and receipts download one by one from{" "}
            <Link href="/documents" className={LINK}>
              Policies and receipts
            </Link>
            .
          </p>
        </section>

        <section
          id="delete"
          className="flex scroll-mt-8 flex-col gap-3 rounded-xl border border-red-200 p-4 dark:border-red-900"
        >
          <h3 className={H3}>Delete all my data</h3>
          <p className={MUTED}>
            We disconnect every linked bank and permanently delete your account, transactions,
            findings and history. This can&apos;t be undone.
          </p>
          <DeleteDataForm />
        </section>
      </Group>
    </>
  );
}

export default function SettingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <SettingsContent />
      </Suspense>
    </main>
  );
}
