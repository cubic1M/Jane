import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");
// What's shown comes from the address bar, so only what could be an address: no sentence of someone's
// choosing appears on Jane's own page.
const ADDRESS = /^[^\s@]{1,64}@[^\s@]{1,189}$/;

// Where a sign-in link lands (src/lib/sign-in-link.ts). Saying which account is the point: a link
// someone else sent you would sign you in as them.
export default async function ContinueSignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const token = one(query.token);
  const email = one(query.email);
  const callbackUrl = one(query.callbackUrl);
  if (!token || !ADDRESS.test(email)) redirect("/login");
  return (
    <div className="flex flex-col gap-4">
      {/* Founder 11-18: registering felt like two-factor. The one tap stays: a mail scanner that
          opens the link can't use it up, and a link someone else sent can't sign a person in by
          itself. The warning is the small print, not the headline. */}
      <h1 className="text-3xl font-semibold tracking-tight">You&apos;re almost in</h1>
      {/* An address is one long word: on a phone it ran off the edge, "…@stanford.e" (debugger
          11-17), so it may break anywhere. */}
      <p className="text-zinc-600 [overflow-wrap:anywhere] dark:text-zinc-400">
        One tap to open Jane as{" "}
        <span className="font-medium text-zinc-950 dark:text-zinc-50">{email}</span>.
      </p>
      <form method="post" action="/login/continue/yes">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <button
          type="submit"
          className="min-h-12 w-full bg-zinc-900 px-4 py-3 text-base font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Open Jane
        </button>
      </form>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Not your email, or you didn&apos;t ask for this link? Don&apos;t continue.{" "}
        <Link href="/login" className="font-medium underline">
          Use a different email
        </Link>
      </p>
    </div>
  );
}
