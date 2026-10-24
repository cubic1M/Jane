import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { TERMS_VERSION } from "@/config/legal";
import { getCurrentUser, HOME_PATH } from "@/lib/session";
import { acceptCurrentTerms } from "./actions";

// Shown once to signed-in people who haven't accepted the current Terms version.
async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/terms/accept">["searchParams"];
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.termsVersion === TERMS_VERSION) redirect(HOME_PATH);
  const { error } = await searchParams;

  return (
    <form action={acceptCurrentTerms} className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold tracking-tight">
        {user.termsVersion ? "We've updated our Terms" : "One more step"}
      </h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Please read and agree to the{" "}
        <Link href="/terms" className="font-medium text-emerald-700 hover:underline">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="font-medium text-emerald-700 hover:underline">
          Privacy Policy
        </Link>{" "}
        to keep using the app.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          Tick the box to continue.
        </p>
      )}
      <label className="flex items-start gap-3">
        <input type="checkbox" name="consent" required className="mt-1 h-5 w-5" />
        <span>I agree to the Terms and Privacy Policy.</span>
      </label>
      <button
        type="submit"
        className="inline-flex h-12 items-center justify-center rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800"
      >
        Continue
      </button>
    </form>
  );
}

export default function AcceptTermsPage({ searchParams }: PageProps<"/terms/accept">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-16">
      <Suspense>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
