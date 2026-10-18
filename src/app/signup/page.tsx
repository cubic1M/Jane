import Link from "next/link";

export default function SignupPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-6 py-20">
      <h1 className="text-3xl font-semibold tracking-tight">Sign-up is coming soon</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        We&apos;re opening accounts shortly. Check back soon.
      </p>
      <Link href="/" className="font-medium text-emerald-700 hover:underline">
        Back to home
      </Link>
    </main>
  );
}
