import Link from "next/link";
import { Suspense } from "react";
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

async function SettingsContent() {
  const user = await requireUser();
  const mine = await scopedDb();
  const [prefs, items, accounts, lastCsv, twoFactor, rules, autopilot] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        digestEnabled: true,
        timezone: true,
        alertPrefs: true,
        state: true,
        calendarCreatedAt: true,
        acceptSimpleOffers: true,
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
  ]);
  const csvUpdated = new Map(lastCsv.map((row) => [row.accountId, row.createdAt]));
  const alerts = alertPrefs(prefs.alertPrefs);
  const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "not yet");

  return (
    <>
      <AppHeader email={user.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      <section id="banks" className="flex scroll-mt-8 flex-col gap-3">
        <h2 className="text-xl font-semibold">Connected banks</h2>
        {items.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">No banks linked.</p>
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
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Your accounts</h2>
          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 px-4 py-3">
                <span>
                  <span className="font-medium">{a.mask ? `${a.name} ····${a.mask}` : a.name}</span>
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

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Money calendar</h2>
        <CalendarForm since={prefs.calendarCreatedAt?.toISOString().slice(0, 10) ?? null} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Where you live</h2>
        <p className="text-zinc-600 dark:text-zinc-400">
          Some offers (like savings accounts from partners) are only available in some states.
        </p>
        <StateForm state={prefs.state} states={US_STATES} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Household</h2>
        <p className="text-zinc-600 dark:text-zinc-400">
          Share chosen accounts with a partner, read-only.{" "}
          <Link href="/household" className="font-medium text-emerald-700 hover:underline">
            Manage your household
          </Link>
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Your data</h2>
        <p className="text-zinc-600 dark:text-zinc-400">
          Download a copy of everything we hold about you, as a JSON file.
        </p>
        <a
          href="/api/export"
          download
          className="inline-flex h-11 items-center justify-center self-start rounded-full border border-zinc-300 px-5 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Download my data
        </a>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Email</h2>
        <EmailForm
          digestEnabled={prefs.digestEnabled}
          timezone={prefs.timezone ?? DEFAULT_TIMEZONE}
          timezones={TIMEZONES}
        />
      </section>

      <section id="alerts" className="flex scroll-mt-8 flex-col gap-3">
        <h2 className="text-xl font-semibold">Alerts</h2>
        <p className="text-zinc-600 dark:text-zinc-400">
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

      <section id="autopilot" className="flex scroll-mt-8 flex-col gap-3">
        <h2 className="text-xl font-semibold">Autopilot</h2>
        <p className="text-zinc-600 dark:text-zinc-400">
          Now:{" "}
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

      <section id="rules" className="flex scroll-mt-8 flex-col gap-3">
        <h2 className="text-xl font-semibold">Fine-tune: standing rules</h2>
        <p className="text-zinc-600 dark:text-zinc-400">
          Things Jane may do without asking each time. Jane tells you whenever a rule is used, and
          you can take it back for a day. Moving money, phone calls, cancelling things and insurance
          always need your yes.
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

      <section id="two-factor" className="flex scroll-mt-8 flex-col gap-3">
        <h2 className="text-xl font-semibold">Two-factor sign-in</h2>
        {twoFactor.enabledAt ? (
          <>
            <p className="text-zinc-600 dark:text-zinc-400">
              On since {day(twoFactor.enabledAt)}. Each new sign-in asks for a code from your
              authenticator app. {twoFactor.backupCodesLeft} backup{" "}
              {twoFactor.backupCodesLeft === 1 ? "code" : "codes"} left.
            </p>
            <TwoFactorOnForms canTurnOff={user.role !== "admin"} />
          </>
        ) : (
          <>
            <p className="text-zinc-600 dark:text-zinc-400">
              Optional extra protection: after the email link or Google, signing in also asks for a
              code from an app on your phone.
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

      <section className="flex flex-col gap-3 rounded-xl border border-red-200 p-4 dark:border-red-900">
        <h2 className="text-xl font-semibold">Delete all my data</h2>
        <p className="text-zinc-600 dark:text-zinc-400">
          We disconnect every linked bank and permanently delete your account, transactions,
          findings and history. This can&apos;t be undone.
        </p>
        <DeleteDataForm />
      </section>
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
