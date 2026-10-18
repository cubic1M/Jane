import Link from "next/link";
import { Suspense } from "react";
import { AuthError } from "@/components/auth-error";
import { AuthForm } from "@/components/auth-form";
import { RedirectIfSignedIn } from "@/components/redirect-if-signed-in";
import { invitesRequired } from "@/lib/invites";

export default function SignupPage({ searchParams }: PageProps<"/signup">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-20">
      <Suspense>
        <RedirectIfSignedIn />
      </Suspense>

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {invitesRequired() && "We're in a private beta, so you'll need an invite code. "}Sign up
          with your email and we&apos;ll send you a link. No password to remember.
        </p>
      </div>

      <Suspense>
        <AuthError searchParams={searchParams} />
      </Suspense>

      <AuthForm submitLabel="Email me a sign-up link" signUp />

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-emerald-700 hover:underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
