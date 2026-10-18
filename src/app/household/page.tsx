import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { scopedDb, sharedReadFor } from "@/lib/db-scoped";
import { householdOf } from "@/lib/household";
import { formatCents } from "@/lib/money";
import { savingsPhrase } from "@/lib/savings-text";
import { requireUser } from "@/lib/session";
import { HOUSEHOLD_MAX_MEMBERS } from "@/config/household";
import { leave, share } from "./actions";
import { InviteForm } from "./forms";

// Emails and account names can be long with no spaces; they wrap rather than push the page
// sideways on a phone.
const CARD =
  "flex min-w-0 flex-col gap-3 rounded-xl border border-zinc-200 p-4 [overflow-wrap:anywhere] dark:border-zinc-800";
const label = (a: { name: string; mask: string | null }) =>
  a.mask ? `${a.name} ····${a.mask}` : a.name;

async function Household() {
  const user = await requireUser();
  const mine = await scopedDb();
  const [household, accounts, shared] = await Promise.all([
    householdOf(user.id),
    mine.accounts.findMany({
      select: { id: true, name: true, mask: true, sharedWithHousehold: true },
      orderBy: { name: "asc" },
    }),
    sharedReadFor(user.id),
  ]);
  const partnerFindings = await shared.findings();
  const partners = household?.members.filter((m) => m.userId !== user.id) ?? [];
  const full = (household?.members.length ?? 1) >= HOUSEHOLD_MAX_MEMBERS;

  return (
    <>
      <AppHeader email={user.email} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Household</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Share some accounts with a partner. They can see what you share, never change it, and
          never see your decisions. You choose each account.
        </p>
      </div>

      {partners.length > 0 ? (
        <section className={CARD}>
          <h2 className="font-semibold">
            You share with {partners.map((p) => p.user.email).join(", ")}
          </h2>
          <form action={leave}>
            <button type="submit" className="text-sm font-medium text-red-700 hover:underline">
              Leave household
            </button>
          </form>
        </section>
      ) : (
        <section className={CARD}>
          <h2 className="font-semibold">Invite your partner</h2>
          {household?.invites[0] && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Waiting for {household.invites[0].email} to join (until{" "}
              {household.invites[0].expiresAt.toISOString().slice(0, 10)}).
            </p>
          )}
          {!full && <InviteForm />}
        </section>
      )}

      <section className={CARD}>
        <h2 className="font-semibold">Accounts you share</h2>
        {accounts.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            You haven&apos;t linked any accounts.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{label(a)}</span>
                <form action={share}>
                  <input type="hidden" name="accountId" value={a.id} />
                  <input type="hidden" name="shared" value={String(!a.sharedWithHousehold)} />
                  <button
                    type="submit"
                    aria-label={`${a.sharedWithHousehold ? "Stop sharing" : "Share"} ${label(a)}`}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${a.sharedWithHousehold ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "border border-zinc-300 dark:border-zinc-700"}`}
                  >
                    {a.sharedWithHousehold ? "Shared · stop" : "Not shared · share"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {partners.length > 0 && (
        <section className={CARD}>
          <h2 className="font-semibold">Shared with you</h2>
          {shared.accounts.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Nothing yet. Your partner chooses which accounts to share.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              {shared.accounts.map((a) => (
                <li key={a.id} className="flex justify-between gap-2 py-2">
                  <span>{label(a)}</span>
                  <span>
                    {a.currentBalanceCents === null
                      ? "No balance"
                      : formatCents(a.currentBalanceCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {partnerFindings.length > 0 && (
            <>
              <h3 className="text-sm font-semibold">Found on shared accounts</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {partnerFindings.map((f) => (
                  <li key={f.id}>
                    {f.title}
                    {f.annualSavingsCents !== null && (
                      <span className="text-zinc-500">
                        {" "}
                        · {savingsPhrase(f.type, f.annualSavingsCents)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-zinc-500">
                Only your partner can decide on these, from their own report.
              </p>
            </>
          )}
        </section>
      )}
    </>
  );
}

export default function HouseholdPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Household />
      </Suspense>
    </main>
  );
}
