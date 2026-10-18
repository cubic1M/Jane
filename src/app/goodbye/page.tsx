import Link from "next/link";

export default function GoodbyePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-20">
      <h1 className="text-3xl font-semibold tracking-tight">Your data is deleted</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        We disconnected your banks and deleted your account and everything in it.
      </p>
      <Link href="/" className="font-medium text-emerald-700 hover:underline">
        Back to the home page
      </Link>
    </main>
  );
}
