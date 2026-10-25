import { Suspense } from "react";
import { db } from "@/lib/db";
import { inviteStatus, invitesRequired, type InviteStatus } from "@/lib/invites";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { revokeInvite } from "./actions";
import { CopyButton } from "./copy-button";
import { InviteForm } from "./invite-form";
import { LoadingBar } from "@/components/loading-bar";

const STATUS: Record<InviteStatus, string> = {
  active: "Active",
  revoked: "Revoked",
  expired: "Expired",
  used_up: "Used up",
};

const day = (d: Date) => d.toISOString().slice(0, 10);

async function Invites() {
  const admin = await requireAdmin();
  // Codes aren't user data, so listing them isn't audit-logged; creating and revoking are.
  const [codes, waitlist] = await Promise.all([
    db.inviteCode.findMany({
      select: {
        code: true,
        maxUses: true,
        uses: true,
        note: true,
        email: true,
        createdById: true,
        revokedAt: true,
        expiresAt: true,
        createdAt: true,
        access: { select: { email: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.waitlistEntry.findMany({
      select: { email: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);
  const makers = await db.user.findMany({
    where: {
      id: { in: [...new Set(codes.flatMap((c) => (c.createdById ? [c.createdById] : [])))] },
    },
    select: { id: true, email: true },
  });
  const maker = new Map(makers.map((m) => [m.id, m.email]));
  const base = process.env.APP_URL ?? "http://localhost:3000";

  return (
    <>
      <AdminNav email={admin.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Invites</h1>
      {!invitesRequired() && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950">
          Sign-up is open to everyone (BETA_INVITE_ONLY=false), so codes aren&apos;t needed right
          now.
        </p>
      )}
      <InviteForm />
      <ul
        aria-label="Invite codes"
        className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800"
      >
        {codes.map((c) => {
          const status = inviteStatus(c);
          return (
            <li key={c.code} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono font-semibold">{c.code}</span>
                <span className="text-zinc-600 dark:text-zinc-400">
                  {STATUS[status]} · {c.uses}/{c.maxUses} used
                  {c.email ? ` · only ${c.email}` : ""}
                  {c.expiresAt ? ` · expires ${day(c.expiresAt)}` : ""}
                  {c.note ? ` · ${c.note}` : ""}
                </span>
              </div>
              <p className="text-xs text-zinc-500">
                Made {day(c.createdAt)}
                {c.createdById ? ` by ${maker.get(c.createdById) ?? "a former admin"}` : ""}
                {c.revokedAt ? ` · revoked ${day(c.revokedAt)}` : ""}
              </p>
              {c.access.length > 0 && (
                <ul
                  aria-label={`Used ${c.code}`}
                  className="text-xs text-zinc-600 dark:text-zinc-400"
                >
                  {c.access.map((a) => (
                    <li key={a.email}>
                      {a.email}, {day(a.createdAt)}
                    </li>
                  ))}
                </ul>
              )}
              {status === "active" && (
                <div className="flex flex-wrap gap-2">
                  <CopyButton text={c.code} label="Copy code" />
                  <CopyButton
                    text={`${base}/signup?invite=${encodeURIComponent(c.code)}`}
                    label="Copy sign-up link"
                  />
                  <form action={revokeInvite}>
                    <input type="hidden" name="code" value={c.code} />
                    <button
                      type="submit"
                      className="rounded-full border border-zinc-900 px-3 py-1 text-xs font-semibold hover:bg-zinc-100 dark:border-zinc-100 dark:hover:bg-zinc-900"
                    >
                      Revoke
                    </button>
                  </form>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <section aria-labelledby="waitlist-title" className="flex flex-col gap-2">
        <h2 id="waitlist-title" className="text-xl font-semibold">
          Waitlist ({waitlist.length})
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Emails left on the sign-up page without an invite. Jane sends them nothing.
        </p>
        {waitlist.length > 0 && (
          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
            {waitlist.map((w) => (
              <li key={w.email} className="flex justify-between gap-2 px-4 py-2">
                <span>{w.email}</span>
                <span className="text-zinc-500">{day(w.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function InvitesPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<LoadingBar />}>
        <Invites />
      </Suspense>
    </main>
  );
}
