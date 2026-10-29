import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { INHERITED_HREF, inheritanceLines } from "@/lib/jane-agent/inheritance-message";
import { loadInheritance } from "@/lib/inheritance";
import { requireUser } from "@/lib/session";

// Inherited money and gifts (spec step 268): an inherited IRA's deadline under the 10-year rule
// and (demo advice) spreading it, gifts over the annual exclusion that need Form 709, the
// step-up in basis and the estate tax facts. The same lines as the chat's answer
// (inheritanceLines). Facts with a pointer to counsel: no legal advice.

const LINK = "font-medium text-emerald-700 underline";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

async function Content() {
  const user = await requireUser();
  await connection();
  const v = await loadInheritance(user.id);
  const spread = v.advice && v.inherited.some((i) => i.spread?.worthRaising);
  return (
    <>
      <AppHeader user={user} />
      <Link href="/taxes" className={`text-sm ${LINK}`}>
        ← Taxes
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Inherited money and gifts</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          An inherited IRA&apos;s deadline, gifts that need a gift tax return, and the estate tax
          facts, from your accounts. Facts for you and a tax professional or estate lawyer to check.
        </p>
      </div>
      <section aria-labelledby="inherited-heading" className={CARD}>
        <h2 id="inherited-heading" className="text-xl font-semibold">
          What applies to you
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          {inheritanceLines(v).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {spread && <DemoAdviceLabel />}
        <p className="text-sm">
          <Link href={INHERITED_HREF} className={LINK}>
            Tell Jane what you inherited
          </Link>{" "}
          ·{" "}
          <Link href="/taxes/accountant" className={LINK}>
            Share with my accountant
          </Link>
        </p>
      </section>
    </>
  );
}

export default function InheritedPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <Content />
      </Suspense>
    </main>
  );
}
