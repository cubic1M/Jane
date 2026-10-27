import { Suspense } from "react";
import { logAudit } from "@/lib/audit";
import { keyReport, UNREADABLE } from "@/lib/key-rotation";
import { LEGACY_KEY_ID } from "@/lib/keyring";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { rotateNow } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { LoadingBar } from "@/components/loading-bar";

// Encryption keys (docs/security/keys.md): which key encrypts how many values, a button to
// move everything to the current key, and when an old key can be removed. Names and counts
// only; no key or value is ever shown.

type Search = { rotated?: string; failed?: string; done?: string; error?: string };

const keyName = (id: string) =>
  id === LEGACY_KEY_ID ? "TOKEN_ENCRYPTION_KEY (the original key)" : `"${id}"`;

function LastRun({ search }: { search: Search }) {
  if (search.error) {
    return (
      <p className="rounded-xl border-2 border-zinc-900 p-3 text-sm font-semibold dark:border-zinc-100">
        Nothing was changed: the current key isn&apos;t working. Fix the problems listed below,
        redeploy, then press the button again.
      </p>
    );
  }
  if (search.rotated === undefined) return null;
  const failed = Number(search.failed ?? 0);
  return (
    <p className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      Last run moved {search.rotated} values to the current key.
      {failed > 0 && ` ${failed} couldn't be moved (their key is missing or wrong).`}{" "}
      {search.done === "1" ? "It went through everything." : "It ran out of time: press it again."}
    </p>
  );
}

async function Keys({ search }: { search: Promise<Search> }) {
  const admin = await requireAdmin();
  const [report, params] = await Promise.all([keyReport(), search]);
  await logAudit({ type: "admin", id: admin.id }, "admin_viewed_keys", null, {});
  const behind = report.keys.filter((k) => !k.current).reduce((sum, k) => sum + k.values, 0);

  return (
    <>
      <AdminNav email={admin.email} />
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Encryption keys</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Bank connections, two-factor secrets and uploaded files are encrypted. New ones use the
          current key, {keyName(report.current)}. Steps: docs/security/keys.md.
        </p>
      </div>

      {report.problems.length > 0 && (
        <section className="flex flex-col gap-1 rounded-xl border-2 border-zinc-900 p-4 text-sm dark:border-zinc-100">
          <h2 className="font-semibold">Fix in Vercel</h2>
          <ul className="list-disc pl-5">
            {report.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Keys</h2>
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
          {report.keys.map((k) => (
            <li key={k.id} className="flex flex-wrap justify-between gap-2 px-4 py-3">
              <span className="font-medium">
                {keyName(k.id)}
                {k.current && " · current"}
              </span>
              <span className={k.retirable ? "font-semibold" : ""}>
                {k.values} values
                {k.retirable && " · not used: safe to remove from Vercel"}
              </span>
            </li>
          ))}
          {report.missing.map((m) => (
            <li key={m.id} className="flex flex-wrap justify-between gap-2 px-4 py-3 font-semibold">
              <span className="font-medium">
                {m.id === UNREADABLE ? "Unreadable values" : `${keyName(m.id)} · missing`}
              </span>
              <span>
                {m.values} values{" "}
                {m.id === UNREADABLE ? "need a look" : "can't be read until this key is added back"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Where they are</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {report.stores.map((s) => (
            <li key={s.name}>
              <span className="font-medium">{s.name}:</span>{" "}
              {Object.entries(s.byKey)
                .map(([id, n]) => `${n} on ${id === LEGACY_KEY_ID ? "the original key" : id}`)
                .join(" · ") || "none"}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Move everything to the current key</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {behind === 0
            ? "Everything is already on the current key."
            : `${behind} values are on an older key.`}{" "}
          Safe to press any time and to press again; it only changes values that need it, and each
          run is written to the audit log.
        </p>
        <LastRun search={params} />
        <form action={rotateNow}>
          <SubmitButton className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
            Re-encrypt with the current key
          </SubmitButton>
        </form>
      </section>
    </>
  );
}

export default function KeysPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<LoadingBar />}>
        <Keys search={searchParams} />
      </Suspense>
    </main>
  );
}
