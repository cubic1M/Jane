import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DEFAULT_TIMEZONE, TIMEZONES } from "@/config/digest";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { EmailForm } from "./email-form";

async function SettingsContent() {
  const user = await requireUser();
  const prefs = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { digestEnabled: true, timezone: true },
  });

  return (
    <>
      <AppHeader email={user.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Email</h2>
        <EmailForm
          digestEnabled={prefs.digestEnabled}
          timezone={prefs.timezone ?? DEFAULT_TIMEZONE}
          timezones={TIMEZONES}
        />
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
