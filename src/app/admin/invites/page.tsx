import { Suspense } from "react";
import { db } from "@/lib/db";
import { invitesRequired } from "@/lib/invites";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { InviteForm } from "./invite-form";

async function Invites() {
  const admin = await requireAdmin();
  // Codes aren't user data, so listing them isn't audit-logged; creating one is.
  const codes = await db.inviteCode.findMany({
    select: { code: true, maxUses: true, uses: true, note: true, expiresAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <>
      <AdminNav email={admin.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Invite codes</h1>
      {!invitesRequired() && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950">
          Sign-up is open to everyone (OPEN_SIGNUPS=true), so codes aren&apos;t needed right now.
        </p>
      )}
      <InviteForm />
      <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
        {codes.map((c) => (
          <li key={c.code} className="flex flex-wrap justify-between gap-2 px-4 py-3">
            <span className="font-mono font-semibold">{c.code}</span>
            <span className="text-zinc-600 dark:text-zinc-400">
              {c.uses}/{c.maxUses} used
              {c.expiresAt ? ` · expires ${c.expiresAt.toISOString().slice(0, 10)}` : ""}
              {c.note ? ` · ${c.note}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function InvitesPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Invites />
      </Suspense>
    </main>
  );
}
