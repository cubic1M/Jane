import Link from "next/link";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { RedirectIfSignedIn } from "@/components/redirect-if-signed-in";
import { AuthError } from "@/components/auth-error";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-20">
      <Suspense>
        <RedirectIfSignedIn />
      </Suspense>

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          We&apos;ll email you a sign-in link. No password needed.
        </p>
      </div>

      <Suspense>
        <AuthError searchParams={searchParams} />
      </Suspense>

      <AuthForm submitLabel="Email me a sign-in link" />

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        New here?{" "}
        <Link href="/signup" className="font-medium text-emerald-700 hover:underline">
          Create an account
        </Link>
      </p>
    </main>
  );
}
