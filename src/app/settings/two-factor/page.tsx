import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { CodeForm } from "@/app/mfa/code-form";
import { enrollment } from "@/lib/mfa";
import { requireUser } from "@/lib/session";

const NEXT = "/settings#two-factor";

// Turning on two-factor: add the key to an authenticator app, then enter its code. The
// first code turns it on and shows the backup codes once. Once it's on, the page says so rather
// than sending the person away: its own re-render after that first code would otherwise take the
// backup codes off the screen before anyone saw them (beta walk 11-12). The code form keeps its
// place either way, so the codes stay up until the person moves on.
async function Content() {
  const user = await requireUser();
  const setup = await enrollment(user.id, user.email ?? user.id);

  return (
    <>
      <AppHeader user={user} />
      <h1 className="text-3xl font-semibold tracking-tight">
        {setup.enrolled ? "Two-factor is on" : "Turn on two-factor"}
      </h1>
      {setup.enrolled ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Each new sign-in asks for a code from your authenticator app.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-zinc-600 dark:text-zinc-400">
            <li>
              Open an authenticator app on your phone (1Password, Google Authenticator, Authy) and
              add this key:
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
        </div>
      )}
      <CodeForm next={NEXT} allowBackup={false} done={setup.enrolled} />
    </>
  );
}

export default function TwoFactorSetupPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<PageLoading />}>
        <Content />
      </Suspense>
    </main>
  );
}
