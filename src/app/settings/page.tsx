import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DEFAULT_TIMEZONE, TIMEZONES } from "@/config/digest";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scoped";
import { requireUser } from "@/lib/session";
import { DeleteDataForm, DisconnectForm } from "./data-forms";
import { EmailForm } from "./email-form";

async function SettingsContent() {
  const user = await requireUser();
  const [prefs, items] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { digestEnabled: true, timezone: true },
    }),
    (await scopedDb()).plaidItems.findMany({
      select: { id: true, institutionName: true, accounts: { select: { name: true, mask: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <>
      <AppHeader email={user.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      <section className="flex flex-col gap-3">
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
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {item.accounts
                      .map((a) => (a.mask ? `${a.name} ····${a.mask}` : a.name))
                      .join(", ")}
                  </p>
                </div>
                <DisconnectForm itemId={item.id} name={item.institutionName ?? "this bank"} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Email</h2>
        <EmailForm
          digestEnabled={prefs.digestEnabled}
          timezone={prefs.timezone ?? DEFAULT_TIMEZONE}
          timezones={TIMEZONES}
        />
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
