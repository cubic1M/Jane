import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { CodeForm } from "@/app/mfa/code-form";
import { enrollment } from "@/lib/mfa";
import { requireUser } from "@/lib/session";
import { LoadingBar } from "@/components/loading-bar";

// Turning on two-factor: add the key to an authenticator app, then enter its code. The
// first code turns it on and shows the backup codes once.
async function Content() {
  const user = await requireUser();
  const setup = await enrollment(user.id, user.email ?? user.id);
  if (setup.enrolled) redirect("/settings#two-factor");

  return (
    <>
      <AppHeader user={user} />
      <h1 className="text-3xl font-semibold tracking-tight">Turn on two-factor</h1>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-zinc-600 dark:text-zinc-400">
        <li>
          Open an authenticator app on your phone (1Password, Google Authenticator, Authy) and add
          this key:
        </li>
      </ol>
      <p className="rounded-lg bg-zinc-100 p-3 font-mono text-sm break-all dark:bg-zinc-900">
        {setup.secret.match(/.{1,4}/g)?.join(" ")}
      </p>
      <a href={setup.uri} className="text-sm font-medium text-emerald-700 hover:underline">
        On your phone? Tap to add it to your authenticator app
      </a>
      <ol
        start={2}
        className="flex list-decimal flex-col gap-2 pl-5 text-zinc-600 dark:text-zinc-400"
      >
        <li>Enter the 6-digit code the app shows. After that, signing in asks for a code.</li>
      </ol>
      <CodeForm next="/settings#two-factor" allowBackup={false} />
    </>
  );
}

export default function TwoFactorSetupPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<LoadingBar />}>
        <Content />
      </Suspense>
    </main>
  );
}
