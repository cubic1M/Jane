import Link from "next/link";
import { gmailOffered } from "@/config/gmail";

export default function GoodbyePage() {
  // Mailboxes are named only while they're offered (docs/setup/gmail.md).
  const gmail = gmailOffered();
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-20">
      <h1 className="text-3xl font-semibold tracking-tight">Your data is deleted</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        We disconnected your banks{gmail && " and mailboxes"} and deleted your account and
        everything in it.
        {gmail &&
          " If Google now lists Jane under the apps with access to your account, you can remove it there."}
      </p>
      <Link href="/" className="font-medium text-emerald-700 hover:underline">
        Back to the home page
      </Link>
    </main>
  );
}
