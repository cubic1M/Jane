import Link from "next/link";
import { Suspense } from "react";

// Reached from an email's unsubscribe link (the weekly digest, or with what=alerts, alert
// emails); works without signing in. The change only
// happens on the button press, so mail scanners that open links don't unsubscribe anyone.

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/unsubscribe">["searchParams"];
}) {
  const { token, done, what } = await searchParams;
  const alerts = what === "alerts";
  if (done === "1") {
    return (
      <>
        <h1 className="text-3xl font-semibold tracking-tight">You&apos;re unsubscribed</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {alerts
            ? "We won't email you alerts anymore. They still show on your alerts page."
            : "We won't send you the weekly email anymore."}{" "}
          You can turn it back on in{" "}
          <Link href="/settings" className="font-medium text-emerald-700 hover:underline">
            settings
          </Link>
          .
        </p>
      </>
    );
  }
  if (typeof token !== "string" || !token) {
    return <p>This unsubscribe link is incomplete. Use the link from your email.</p>;
  }
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">
        {alerts ? "Stop alert emails?" : "Stop the weekly email?"}
      </h1>
      <form
        method="post"
        action={`/api/unsubscribe?${new URLSearchParams({ token, from: "page", ...(alerts ? { what: "alerts" } : {}) })}`}
      >
        <button
          type="submit"
          className="inline-flex h-12 items-center justify-center rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800"
        >
          Unsubscribe
        </button>
      </form>
    </>
  );
}

export default function UnsubscribePage({ searchParams }: PageProps<"/unsubscribe">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-20">
      <Suspense>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
