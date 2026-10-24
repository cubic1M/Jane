import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { viewReplyLink } from "@/lib/jane-agent/reply-links";
import { getCurrentUser } from "@/lib/session";
import { ReplyForm } from "./reply-form";
import { LoadingBar } from "@/components/loading-bar";

// The link is private to the person: never indexed.
export const metadata = { title: "Answer Jane", robots: { index: false, follow: false } };

// Opened from a button in Jane's email (spec step 85). The link's token is the credential,
// so no sign-in; opening the page changes nothing, the button does (a POST), so mail
// scanners that open links can't answer anything.

const LINK = "font-medium text-emerald-700 hover:underline";

function Jane({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-zinc-500">
      <span className="font-semibold text-emerald-700">
        jane<span aria-hidden="true">&gt;</span>
      </span>{" "}
      {children}
    </p>
  );
}

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/chat/reply">["searchParams"];
}) {
  // Per request: the link's state depends on the time and who's signed in.
  await connection();
  const { token } = await searchParams;
  const value = typeof token === "string" ? token : "";
  const signedIn = await getCurrentUser();
  const view = await viewReplyLink(value, { signedInAs: signedIn?.id ?? null });

  if (view.state === "ready") {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Answer Jane</h1>
        <div className="flex flex-col gap-2 border border-zinc-300 p-3 dark:border-zinc-700">
          <Jane>from your chat</Jane>
          <p className="whitespace-pre-line [overflow-wrap:anywhere]">{view.body}</p>
        </div>
        <p>
          Your answer: <strong>{view.label}</strong>
        </p>
        <ReplyForm token={value} label={view.label} />
        <Link href={`/chat#${view.messageId}`} className={LINK}>
          Open it in the chat instead
        </Link>
      </>
    );
  }

  // Used: the person usually lands here straight after tapping (the page reloads once the
  // answer goes through), so it says what happened rather than only that the link is spent.
  if (view.state === "used" && (view.note || view.answeredWith)) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">
          {view.answeredWith ? `Answered: ${view.answeredWith}` : "Answered"}
        </h1>
        {view.note && (
          <p role="status" className="font-semibold">
            <span aria-hidden="true">&gt; </span>
            {view.note}
          </p>
        )}
        <p className="text-zinc-600 dark:text-zinc-400">Each link works once.</p>
        <Link href={`/chat#${view.messageId}`} className={LINK}>
          Open the chat
        </Link>
      </>
    );
  }

  const text = {
    invalid: ["This link doesn't work", "Your messages from Jane are always in the chat."],
    expired: ["This link has expired", "Links from Jane's emails work for a few days."],
    wrong_user: [
      "This link is for a different account",
      "Sign out and open it again, or answer in the chat of the account it was sent to.",
    ],
    used: ["This link was already used", "Each link works once. See what happened in the chat."],
    answered: ["Already answered", "This message was answered already. See it in the chat."],
  }[view.state];
  const href = "messageId" in view ? `/chat#${view.messageId}` : "/chat";
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{text[0]}</h1>
      <p className="text-zinc-600 dark:text-zinc-400">{text[1]}</p>
      <Link href={href} className={LINK}>
        Open the chat
      </Link>
    </>
  );
}

export default function ReplyPage({ searchParams }: PageProps<"/chat/reply">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-5 px-4 py-16">
      <Suspense fallback={<LoadingBar />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
