import { Suspense } from "react";
import { requireUser } from "@/lib/session";
import { JoinForm } from "../forms";

// The invite link. Joining only happens on the button press, so email scanners that open
// links don't join anyone.
async function Join({
  searchParams,
}: {
  searchParams: PageProps<"/household/join">["searchParams"];
}) {
  const user = await requireUser();
  const { token } = await searchParams;
  if (typeof token !== "string" || !token) {
    return <p>This invite link is incomplete. Use the link your partner sent.</p>;
  }
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Join a household?</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        You&apos;ll see the accounts your partner shares. Nothing of yours is shared until you
        choose an account. Signed in as {user.email}.
      </p>
      <JoinForm token={token} />
    </>
  );
}

export default function JoinPage({ searchParams }: PageProps<"/household/join">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-20">
      <Suspense>
        <Join searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
