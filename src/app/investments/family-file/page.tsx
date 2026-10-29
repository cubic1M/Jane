import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { BENEFICIARY_EVENTS, FILE_SECTIONS, RELATIONSHIPS } from "@/config/family-file";
import { loadFamilyFile } from "@/lib/investments/family-file";
import { requireUser } from "@/lib/session";
import { addEvent, saveFileContacts, saveNames, saveSharing, stillRight } from "./actions";
import { SubmitButton } from "@/components/submit-button";

// The family looked after (spec step 237): who is named on each account, what a life event makes
// out of date, and a file the person shares in part. Facts only about wills and trusts, with a
// pointer to a lawyer. Nothing here changes an account; the forms are the person's to file.

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON = "h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const FIELD = "h-10 rounded-lg border border-zinc-300 px-3 dark:border-zinc-700 dark:bg-zinc-900";
const PROBLEM = {
  missing: "Nobody is named.",
  shares: "The shares don't add up to 100.",
  out_of_date: "You haven't confirmed these names since a life change.",
} as const;

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/investments/family-file">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { done } = await searchParams;
  const v = await loadFamilyFile(user.id);
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">The family looked after</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Who is named on each account, and a file of what your family would need. Jane records what
          you tell it; Jane doesn&apos;t change anything at a bank or a plan. The form is yours to
          file with them.
        </p>
      </div>
      {done && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {done === "shares" || done === "event" || done === "none"
            ? "That didn't save. Check the shares add up to 100, or the date."
            : "Saved."}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Your accounts</h2>
        {v.checks.length === 0 && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No accounts to check yet.</p>
        )}
        {v.checks.map((c) => (
          <div
            key={c.accountId}
            className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <h3 className="font-semibold">{c.accountName}</h3>
            <p className="text-sm">
              {c.names.length > 0 ? `Named: ${c.names.join(", ")}.` : "Nobody named."}{" "}
              {c.type === "tod"
                ? "If your bank or broker offers it, you can set this up to pass straight to someone you name (transfer-on-death)."
                : ""}
            </p>
            {c.problems.map((p) => (
              <p key={p} className="text-sm font-medium text-amber-700 dark:text-amber-400">
                {PROBLEM[p]}
                {p === "out_of_date" && c.because
                  ? ` (${BENEFICIARY_EVENTS[c.because].toLowerCase()} since)`
                  : ""}
              </p>
            ))}
            {c.names.length > 0 && (
              <form action={stillRight}>
                <input type="hidden" name="accountId" value={c.accountId} />
                <SubmitButton
                  className={`h-9 rounded-lg border border-zinc-300 px-3 text-sm dark:border-zinc-700`}
                >
                  These are still right
                </SubmitButton>
              </form>
            )}
            <details>
              <summary className={`cursor-pointer text-sm ${LINK}`}>Tell Jane who is named</summary>
              <form action={saveNames} className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="accountId" value={c.accountId} />
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <input
                      name={`name${i}`}
                      aria-label={`${i > 2 ? "Backup name" : "Name"} ${i}`}
                      placeholder={i > 2 ? "Backup name" : "Name"}
                      className={FIELD}
                    />
                    <select
                      name={`relationship${i}`}
                      aria-label={`Relationship ${i}`}
                      className={FIELD}
                    >
                      {RELATIONSHIPS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    {i <= 2 && (
                      <input
                        name={`share${i}`}
                        type="number"
                        min={0}
                        max={100}
                        aria-label={`Share ${i} (percent)`}
                        placeholder="Share %"
                        className={`${FIELD} w-24`}
                      />
                    )}
                  </div>
                ))}
                <SubmitButton className={`${BUTTON} self-start`}>Save</SubmitButton>
              </form>
            </details>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">What changed in your life</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          A marriage, a divorce or a new child usually means the names above should be looked at
          again.{" "}
          {v.events.length > 0
            ? `Noted so far: ${v.events.map((e) => `${BENEFICIARY_EVENTS[e.kind].toLowerCase()} on ${e.on}`).join(", ")}.`
            : ""}
        </p>
        <form action={addEvent} className="flex flex-wrap items-center gap-2">
          <select name="kind" aria-label="What happened" className={FIELD}>
            {Object.entries(BENEFICIARY_EVENTS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <input name="on" type="date" aria-label="When" className={FIELD} />
          <SubmitButton className={BUTTON}>Note it</SubmitButton>
        </form>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Wills and trusts</h2>
        <ul className="list-disc pl-5 text-sm">
          {v.facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className="text-sm">{v.pointer}</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">What my family would need</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Pick what goes in the file. Only the parts you tick are in it; balances and logins never
          are.
        </p>
        <form action={saveFileContacts} className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <input
                name={`cname${i}`}
                aria-label={`Contact ${i} name`}
                placeholder="Name"
                className={FIELD}
                defaultValue={v.contacts[i - 1]?.name ?? ""}
              />
              <input
                name={`crole${i}`}
                aria-label={`Contact ${i} role`}
                placeholder="Role (lawyer, accountant…)"
                className={FIELD}
                defaultValue={v.contacts[i - 1]?.role ?? ""}
              />
              <input
                name={`cphone${i}`}
                aria-label={`Contact ${i} phone`}
                placeholder="Phone"
                className={FIELD}
                defaultValue={v.contacts[i - 1]?.phone ?? ""}
              />
              <input
                name={`cemail${i}`}
                aria-label={`Contact ${i} email`}
                placeholder="Email"
                className={FIELD}
                defaultValue={v.contacts[i - 1]?.email ?? ""}
              />
            </div>
          ))}
          <label className="flex flex-col gap-1 text-sm">
            Where your documents are kept
            <textarea
              name="documents"
              rows={2}
              className="rounded-lg border border-zinc-300 p-2 dark:border-zinc-700 dark:bg-zinc-900"
              defaultValue={v.documents}
            />
          </label>
          <SubmitButton className={`${BUTTON} self-start`}>Save contacts and notes</SubmitButton>
        </form>
        <form action={saveSharing} className="flex flex-col gap-2">
          <fieldset className="flex flex-col gap-1">
            <legend className="font-semibold">Include in the file</legend>
            {Object.entries(FILE_SECTIONS).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="picks"
                  value={key}
                  defaultChecked={v.picks.includes(key as never)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <SubmitButton className={`${BUTTON} self-start`}>Save my picks</SubmitButton>
        </form>
        <p className="text-sm">
          <a href="/investments/family-file/export" className={LINK}>
            Download the file
          </a>{" "}
          (
          {v.picks.length === 0
            ? "nothing picked yet"
            : `${v.picks.length} part${v.picks.length === 1 ? "" : "s"} picked`}
          ). You decide who to give it to.
        </p>
      </section>
    </>
  );
}

export default function FamilyFilePage(props: PageProps<"/investments/family-file">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
