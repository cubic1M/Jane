import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { signOutToHome } from "@/lib/auth-actions";
import { enrollment } from "@/lib/mfa";
import { getSessionState } from "@/lib/session";
import { CodeForm } from "./code-form";
import { safeNext } from "./next-path";

// Two-factor: anyone who turned it on enters a code once per session before the app
// opens; admins set it up here the first time, before the team pages open.

async function Content({ searchParams }: { searchParams: PageProps<"/mfa">["searchParams"] }) {
  const state = await getSessionState();
  if (!state) redirect("/login");
  const { user, mfaPending } = state;
  const next = safeNext((await searchParams).next, user.role);
  if (!mfaPending && user.role !== "admin") redirect(next);
  const setup = await enrollment(user.id, user.email ?? user.id);
  // An admin who already entered a code in this session has nothing to do here.
  if (!mfaPending && setup.enrolled) redirect(next);
  if (!setup.enrolled && user.role !== "admin") notFound();

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Two-factor check</h1>
      {setup.enrolled ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Enter the code from your authenticator app. Lost your phone? Use one of your backup codes.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-zinc-600 dark:text-zinc-400">
            Team pages show people&apos;s financial data, so they need two-factor. Add this key to
            an authenticator app (1Password, Google Authenticator, Authy), then enter the code it
            shows.
          </p>
          <p className="rounded-lg bg-zinc-100 p-3 font-mono text-sm break-all dark:bg-zinc-900">
            {setup.secret.match(/.{1,4}/g)?.join(" ")}
          </p>
          <a href={setup.uri} className="text-sm font-medium text-emerald-700 hover:underline">
            On your phone? Tap to add it to your authenticator app
          </a>
        </div>
      )}
      <CodeForm next={next} allowBackup={setup.enrolled} />
      <form action={signOutToHome}>
        <button type="submit" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
          Sign out instead
        </button>
      </form>
    </>
  );
}

export default function MfaPage({ searchParams }: PageProps<"/mfa">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-16">
      <Suspense>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
