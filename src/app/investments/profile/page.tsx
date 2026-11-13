import Link from "next/link";
import { connection } from "next/server";
import { AppHeader } from "@/components/app-header";
import { profileOf } from "@/lib/investments/profile";
import { requireUser } from "@/lib/session";
import { todayOf } from "@/lib/today";
import { currentAge, profileSummary } from "@/planning/investor-profile";
import { ProfileForm } from "./profile-form";
import { PageShell } from "@/components/page-shell";
import { DoneBanner } from "@/components/done-banner";

// What the investments are for (spec step 129): the four answers, the risk level that
// follows and why, changeable any time. Jane asks the same questions in the chat.

async function ProfileContent({
  searchParams,
}: {
  searchParams: PageProps<"/investments/profile">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { saved } = await searchParams;
  const asOf = await todayOf(user.id);
  const answers = await profileOf(user.id);
  const summary = profileSummary(answers, asOf);
  const age = currentAge(answers, asOf);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className="text-sm font-medium text-emerald-700 hover:underline">
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Your investor profile</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Four questions about what your investments are for. Jane checks your investments against
          these answers, and uses nothing until all four are in. Change them any time.
        </p>
      </div>

      {saved && <DoneBanner>Saved.</DoneBanner>}

      <section className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        {summary.complete ? (
          <>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">Your risk level</span>
            <span className="text-2xl font-semibold">{summary.label}</span>
            <span className="text-sm">{summary.why}</span>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">{summary.description}</span>
            {summary.stale && (
              <span className="text-sm text-amber-800 dark:text-amber-200">
                You answered over a year ago. Worth checking it still fits.
              </span>
            )}
          </>
        ) : (
          <span className="text-sm">
            {summary.answered} of 4 answered. Your risk level shows once all four are in.
          </span>
        )}
      </section>

      <ProfileForm
        values={{
          age: age === null ? "" : String(age),
          horizon: answers.horizon ?? "",
          dropReaction: answers.dropReaction ?? "",
          goals: answers.goals,
        }}
      />
    </>
  );
}

export default function ProfilePage(props: PageProps<"/investments/profile">) {
  return (
    <PageShell>
      <ProfileContent searchParams={props.searchParams} />
    </PageShell>
  );
}
