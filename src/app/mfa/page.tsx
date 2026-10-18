import { notFound } from "next/navigation";
import { Suspense } from "react";
import { enrollment } from "@/lib/mfa";
import { getCurrentUser } from "@/lib/session";
import { CodeForm } from "./code-form";

// Two-factor for admins: set up an authenticator app the first time, then enter a code
// once per session before the admin pages open.

async function Content({ searchParams }: { searchParams: PageProps<"/mfa">["searchParams"] }) {
  const user = await getCurrentUser();
  if (user?.role !== "admin") notFound();
  const { next } = await searchParams;
  const setup = await enrollment(user.id, user.email ?? user.id);

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Two-factor check</h1>
      {setup.enrolled ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Enter the code from your authenticator app to open the team pages.
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
      <CodeForm next={typeof next === "string" ? next : "/admin/queue"} />
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
