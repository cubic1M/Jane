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
      <h1 className="text-3xl font-semibold tracking-tight">Sign in as {email}?</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Only continue if this is your email and you asked for this link. If someone sent it to you,
        it signs you in to their account, and anything you add would be theirs to see.
      </p>
      <form method="post" action="/login/continue/yes">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Continue
        </button>
      </form>
      <Link href="/login" className="font-medium underline">
        Use a different email
      </Link>
    </div>
  );
}
