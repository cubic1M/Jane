import Link from "next/link";

export default function CheckEmailPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold tracking-tight">Check your email</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        We sent you a sign-in link. It works once and expires in 24 hours.
      </p>
      <Link href="/login" className="font-medium text-emerald-700 hover:underline">
        Use a different email
      </Link>
    </div>
  );
}
