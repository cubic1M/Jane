import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
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
import { isTrialUser } from "@/lib/trial-ids";
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
import { sessionTokenFrom } from "@/lib/admin-gate";
import { listSessions } from "@/lib/user-sessions";
import { SessionsList } from "./sessions-list";
import { CHAT_NOTIFY_KIND_LABELS, CHAT_NOTIFY_KINDS } from "@/config/chat-notify";
import { chatNotifyPrefs } from "@/lib/jane-agent/notify-prefs";
import { ChatNotifyForm } from "./chat-notify-form";
import { messagesFromJaneWords } from "./notify-words";
import { LinkButton } from "@/app/connect/link-button";
import { ITEM_STATUS } from "@/lib/plaid/sync";
import { listPreferences, postingOf } from "@/lib/jane-agent/preferences";
import { styleOf } from "@/lib/jane-agent/style";
import { StyleForm } from "./style-form";
import { MemoryList } from "./memory-list";
import { loadAttention } from "@/lib/jane-agent/attention-load";
import { AttentionList } from "./attention-list";
import { SECTOR_ALL_MEANS, SECTOR_LABELS } from "@/config/autopilot-sectors";
import { sectorAutopilots } from "@/lib/sector-autopilot";
import { SectorsForm } from "./sectors-form";
import { dayLabel } from "@/lib/day-label";
import { openBooks } from "@/lib/books";
import { importEnded } from "@/lib/books-fix";
import { SETTINGS_ANCHORS, anchorFocus, itemId, settingsTree } from "@/lib/area-pages/settings";
import { SettingsArea } from "./settings-area";

// Settings (spec step 79; docs/design/area-pages.md): the area's tree, one item per setting
// with what it's set to, and the one thing picked below it. Each form sits in its item's detail
// under the section id it always had, and the old #anchors open that item (./settings-area.tsx).

const MUTED = "text-sm text-zinc-600 dark:text-zinc-400";
// Black, white and grey only: meaning comes from glyphs and underlines, not hue.
const LINK = "font-medium underline underline-offset-2 hover:no-underline";
const RECONNECT =
  "inline-flex h-11 items-center justify-center self-start rounded-full border border-zinc-300 px-5 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";
const BOX = "flex scroll-mt-8 flex-col gap-3";

// How Jane's messages go out, as the tree shows it.
const CHANNEL_WORDS: Record<string, string> = {
  push: "Phone",
  email: "Email",
  both: "Phone and email",
  off: "Off",
};

async function SettingsContent({
  searchParams,
}: {
  searchParams: PageProps<"/settings">["searchParams"];
}) {
  const user = await requireUser();
  const params = await searchParams;
  // Where you're signed in (spec step 73): this session is found by its cookie, here on the
  // server; the page only ever gets row ids and labels.
  const token = sessionTokenFrom(await cookies());
  const mine = await scopedDb();
  const [
    prefs,
    items,
    accounts,
    lastCsv,
    twoFactor,
    rules,
    autopilot,
    remembered,
    sectors,
    attention,
    books,
    owned,
    documents,
    sessions,
  ] = await Promise.all([
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
        status: true,
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
    loadAttention(user.id),
    openBooks(user.id),
    mine.ownedAssets.count(),
    mine.documents.count(),
    listSessions(user.id, token),
  ]);
  const csvUpdated = new Map(lastCsv.map((row) => [row.accountId, row.createdAt]));
  const alerts = alertPrefs(prefs.alertPrefs);
  const chatNotify = chatNotifyPrefs(prefs.chatNotifyPrefs);
  const day = (d: Date | null | undefined) => (d ? dayLabel(d, { year: true }) : "not yet");
  const ended = new Map(
    books.open
      .filter((o) => importEnded(o) && o.accountId)
      .map((o) => [o.accountId as string, o.words]),
  );
  const imported = accounts.filter((a) => a.source !== "plaid");
  const autopilotLabel =
    autopilot === null
      ? null
      : autopilot === "custom"
        ? "Your own rules"
        : AUTOPILOT_LEVELS[autopilot].label;

  const area = settingsTree({
    banks: items.map((item) => ({
      id: item.id,
      name: item.institutionName ?? "Your bank",
      updated: day(item.lastSyncedAt),
      accounts: item.accounts.length,
      needsSignIn: item.status === ITEM_STATUS.loginRequired,
    })),
    imports: imported.map((a) => ({
      id: a.id,
      name: a.mask ? `${a.name} ····${a.mask}` : a.name,
      lastImport: day(csvUpdated.get(a.id)),
      ended: ended.get(a.id) ?? null,
    })),
    autopilot: autopilotLabel,
    sectorsOn: sectors.filter((s) => s.level !== "ask").length,
    sectors: sectors.length,
    rulesOn: rules.filter((r) => r.enabled).length,
    channel: CHANNEL_WORDS[chatNotify.channel] ?? chatNotify.channel,
    alertsOn: ALERT_TYPES.filter((type) => alerts[type] !== "off").length,
    alerts: ALERT_TYPES.length,
    digest: prefs.digestEnabled,
    remembered: remembered.filter((p) => p.kind !== "style").length,
    state: prefs.state,
    owned,
    documents,
    twoFactor: twoFactor.enabledAt !== null,
    calendar: prefs.calendarCreatedAt !== null,
  });

  const details: Record<string, ReactNode> = {};
  const more: Record<string, ReactNode> = {};

  // Banks and files: each bank's Refresh and Disconnect (and Reconnect when it needs a sign-in),
  // its accounts behind More.
  for (const item of items) {
    const id = itemId("banks", `item-${item.id}`);
    details[id] = (
      <div className={BOX}>
        {item.status === ITEM_STATUS.loginRequired && (
          // The same Reconnect as /connect: Plaid Link in update mode.
          <LinkButton itemId={item.id} label="Reconnect" className={RECONNECT} />
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <RefreshForm itemId={item.id} />
          <DisconnectForm itemId={item.id} name={item.institutionName ?? "this bank"} />
        </div>
      </div>
    );
    more[id] = (
      <ul className="flex flex-col divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
        {accounts
          .filter((a) => a.item?.institutionName === item.institutionName && a.source === "plaid")
          .map((a) => (
            <li key={a.id} data-private className="flex flex-wrap justify-between gap-2 py-1.5">
              <span>{a.mask ? `${a.name} ····${a.mask}` : a.name}</span>
              <span className="font-medium">
                {a.currentBalanceCents === null ? "No balance" : formatCents(a.currentBalanceCents)}
              </span>
            </li>
          ))}
      </ul>
    );
  }
  for (const a of imported) {
    details[itemId("banks", `csv-${a.id}`)] = (
      <div className={BOX}>
        <p className={MUTED}>
          Balance:{" "}
          {a.currentBalanceCents === null ? "none yet" : formatCents(a.currentBalanceCents)}
        </p>
        <Link href="/import" className={`self-start text-sm ${LINK}`}>
          {ended.has(a.id) ? "Import a newer file" : "Import a file"}
        </Link>
      </div>
    );
  }
  details[itemId("banks", "add")] = (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      <Link href="/connect" className={LINK}>
        Link a bank
      </Link>
      <Link href="/import" className={LINK}>
        Import a file
      </Link>
    </div>
  );

  details[itemId("autopilot", "level")] = (
    <div id="autopilot" className={BOX}>
      <AutopilotChooser compact />
      <CallOffersForm accept={prefs.acceptSimpleOffers} />
    </div>
  );
  details[itemId("autopilot", "sectors")] = (
    <div id="sectors" className={BOX}>
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
    </div>
  );
  more[itemId("autopilot", "sectors")] = (
    <p className={MUTED}>
      Over a cap, Jane asks. Free checks (reshopping, rate checks) run in every area.
    </p>
  );
  details[itemId("autopilot", "rules")] = (
    <div id="rules" className={BOX}>
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
    </div>
  );
  more[itemId("autopilot", "rules")] = (
    <p className={MUTED}>
      Jane tells you whenever a rule is used, and you can take it back for a day. Moving money,
      phone calls, cancelling things and insurance always need your yes.
    </p>
  );

  // Spec step 138: a trial person is never emailed or notified, whatever is set here.
  const trialNote = isTrialUser(user.id) ? (
    <p role="note" className={MUTED}>
      You&apos;re trying Jane with a sample person, so nothing here is emailed or sent to a phone.
      These settings show how it works;{" "}
      <Link href="/signup" className={LINK}>
        sign up
      </Link>{" "}
      to get them.
    </p>
  ) : null;
  details[itemId("notify", "messages")] = (
    <div id="jane-messages" className={BOX}>
      {trialNote}
      <ChatNotifyForm
        channel={chatNotify.channel}
        kinds={CHAT_NOTIFY_KINDS.map((kind) => ({
          kind,
          label: CHAT_NOTIFY_KIND_LABELS[kind],
          on: chatNotify.kinds[kind],
        }))}
      />
    </div>
  );
  more[itemId("notify", "messages")] = <p className={MUTED}>{messagesFromJaneWords()}</p>;
  details[itemId("notify", "alerts")] = (
    <div id="alerts" className={BOX}>
      {trialNote}
      <AlertsForm
        rows={ALERT_TYPES.map((type) => ({
          type,
          ...ALERT_LABELS[type],
          urgent: isUrgent(type),
          value: alerts[type],
        }))}
      />
      {vapidPublicKey() && <NotificationsToggle publicKey={vapidPublicKey() ?? ""} />}
    </div>
  );
  more[itemId("notify", "alerts")] = (
    <p className={MUTED}>
      Emails right away are limited to {ALERT_EMAILS_PER_DAY} a day; anything else waits for the
      weekly email.
    </p>
  );
  details[itemId("notify", "email")] = (
    <div id="email" className={BOX}>
      {trialNote}
      <EmailForm
        digestEnabled={prefs.digestEnabled}
        timezone={prefs.timezone ?? DEFAULT_TIMEZONE}
        timezones={TIMEZONES}
      />
    </div>
  );
  details[itemId("notify", "asking")] = (
    <div id="asking-less" className={BOX}>
      <AttentionList attention={attention} />
    </div>
  );

  details[itemId("memory", "told")] = (
    <div id="remembers" className={BOX}>
      <Link href="/settings/memory" className={`self-start ${LINK}`}>
        What Jane knows about you
      </Link>
      <MemoryList preferences={remembered} />
    </div>
  );
  more[itemId("memory", "told")] = (
    <p className={MUTED}>Jane uses these in its answers and suggestions.</p>
  );
  details[itemId("memory", "style")] = (
    <div className={BOX}>
      <StyleForm style={styleOf(remembered)} posting={postingOf(remembered)} />
    </div>
  );
  more[itemId("memory", "style")] = (
    <p className={MUTED}>
      Or say it in the chat, like &quot;keep it short&quot;, and tap Remember this.
    </p>
  );

  details[itemId("household", "state")] = (
    <div id="where-you-live" className={BOX}>
      <StateForm state={prefs.state} states={US_STATES} />
    </div>
  );
  details[itemId("household", "owned")] = (
    <Link href="/things" className={`self-start text-sm ${LINK}`}>
      Things you own
    </Link>
  );
  details[itemId("household", "documents")] = (
    <Link href="/documents" className={`self-start text-sm ${LINK}`}>
      Policies and receipts
    </Link>
  );

  details[itemId("security", "two-factor")] = (
    <div id="two-factor" className={BOX}>
      {twoFactor.enabledAt ? (
        <>
          <p className={MUTED}>
            On since {day(twoFactor.enabledAt)}. {twoFactor.backupCodesLeft} backup{" "}
            {twoFactor.backupCodesLeft === 1 ? "code" : "codes"} left.
          </p>
          <TwoFactorOnForms canTurnOff={user.role !== "admin"} />
        </>
      ) : (
        <Link
          href="/settings/two-factor"
          className="inline-flex h-11 w-fit items-center justify-center rounded-full bg-zinc-900 px-6 font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Turn on two-factor
        </Link>
      )}
    </div>
  );
  details[itemId("security", "sessions")] = (
    <div id="sessions" className={BOX}>
      <SessionsList sessions={sessions} />
    </div>
  );
  details[itemId("security", "calendar")] = (
    <div id="calendar" className={BOX}>
      <CalendarForm since={prefs.calendarCreatedAt?.toISOString().slice(0, 10) ?? null} />
    </div>
  );

  details[itemId("data", "download")] = (
    <div id="your-data" className={BOX}>
      <a
        href="/api/export"
        download
        className="inline-flex h-11 items-center justify-center self-start rounded-full border border-zinc-300 px-5 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Download my data
      </a>
    </div>
  );
  more[itemId("data", "download")] = (
    <p className={MUTED}>
      Uploaded policies, warranties and receipts download one by one from{" "}
      <Link href="/documents" className={LINK}>
        Policies and receipts
      </Link>
      .
    </p>
  );
  details[itemId("data", "delete")] = (
    <div id="delete" className={BOX}>
      <DeleteDataForm />
    </div>
  );

  const focus = typeof params.focus === "string" ? params.focus : undefined;
  const anchors = Object.fromEntries(
    Object.keys(SETTINGS_ANCHORS).flatMap((anchor) => {
      const to = anchorFocus(anchor, area);
      return to ? [[anchor, to]] : [];
    }),
  );

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          What each setting is now. Open a branch to change one.
        </p>
        <nav aria-label="Settings pages" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href="/connect" className={LINK}>
            Connect
          </Link>
          <Link href="/import" className={LINK}>
            Import
          </Link>
          <Link href="/documents" className={LINK}>
            Documents
          </Link>
        </nav>
      </div>

      <SettingsArea
        tree={area.tree}
        label="Settings"
        chips={area.chips}
        summaries={area.summaries}
        details={details}
        more={more}
        focus={focus}
        anchors={anchors}
      />
    </>
  );
}

export default function SettingsPage({ searchParams }: PageProps<"/settings">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <Suspense fallback={<PageLoading />}>
        <SettingsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
