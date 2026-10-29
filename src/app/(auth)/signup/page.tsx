import Link from "next/link";
import { Suspense } from "react";
import { AuthError } from "@/components/auth-error";
import { ACTIVITY_DISCLOSURE } from "@/config/activity";
import { AuthForm } from "@/components/auth-form";
import { RedirectIfSignedIn } from "@/components/redirect-if-signed-in";
import { SubmitButton } from "@/components/submit-button";
import { joinTheWaitlist } from "@/lib/auth-actions";
import { invitesRequired, normalizeCode } from "@/lib/invites";

const FIELD =
  "h-12 rounded-lg border border-zinc-300 bg-transparent px-4 text-base focus-visible:outline-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:focus-visible:outline-zinc-100";

type Params = Promise<{
  invite?: string | string[];
  waitlist?: string | string[];
  error?: string | string[];
}>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// The form, with the code from an invite link (/signup?invite=CODE) already filled in. Without
// one, during the closed beta: who to ask, and the waitlist (stored, nothing sent).
async function SignupForm({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const invite = normalizeCode(first(params.invite) ?? "") ?? undefined;
  const closed = invitesRequired();
  const joined = first(params.waitlist) === "joined";
  // Sent here from sign-in without an invite: the error above already says who to ask.
  const said = first(params.error) === "InviteRequired";
  return (
    <>
      {closed && !invite && !said && (
        <p
          role="note"
          className="rounded-lg bg-zinc-100 px-4 py-3 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        >
          Jane is in private beta. Ask a founder for an invite. Have a code? Enter it below.
        </p>
      )}

      <AuthForm submitLabel="Email me a sign-up link" signUp invite={invite} />

      {closed && !invite && (
        <section aria-labelledby="waitlist-title" className="flex flex-col gap-3">
          <h2 id="waitlist-title" className="text-lg font-semibold">
            No invite yet?
          </h2>
          {joined ? (
            <p role="status" className="text-sm font-medium">
              You&apos;re on the waitlist. We keep your email for the beta and send nothing until a
              founder invites you.
            </p>
          ) : (
            <form action={joinTheWaitlist} className="flex flex-col gap-3">
              <label htmlFor="waitlist-email" className="text-sm font-medium">
                Join the waitlist
              </label>
              <input
                id="waitlist-email"
                name="email"
                data-private
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                className={FIELD}
              />
              <SubmitButton className="inline-flex h-12 items-center justify-center rounded-full border border-zinc-300 px-8 text-base font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
                Join the waitlist
              </SubmitButton>
            </form>
          )}
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Or{" "}
            <Link href="/" className="font-medium underline hover:no-underline">
              try Jane with sample data
            </Link>{" "}
            from the home page: no invite needed.
          </p>
        </section>
      )}
    </>
  );
}

export default function SignupPage({ searchParams }: PageProps<"/signup">) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense>
        <RedirectIfSignedIn />
      </Suspense>

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Sign up with your email and we&apos;ll send you a link. No password to remember.
        </p>
      </div>

      <Suspense>
        <AuthError searchParams={searchParams} />
      </Suspense>

      <Suspense fallback={<AuthForm submitLabel="Email me a sign-up link" signUp />}>
        <SignupForm searchParams={searchParams} />
      </Suspense>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">{ACTIVITY_DISCLOSURE}</p>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-emerald-700 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
