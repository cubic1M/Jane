import { googleEnabled } from "@/auth";
import { signInWithEmail, signInWithGoogle } from "@/lib/auth-actions";

const PRIMARY_BUTTON =
  "inline-flex h-12 items-center justify-center rounded-full bg-emerald-700 px-8 text-base font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700";

const SECONDARY_BUTTON =
  "inline-flex h-12 w-full items-center justify-center rounded-full border border-zinc-300 px-8 text-base font-semibold transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 dark:border-zinc-700 dark:hover:bg-zinc-900";

export function AuthForm({ submitLabel }: { submitLabel: string }) {
  return (
    <div className="flex flex-col gap-6">
      <form action={signInWithEmail} className="flex flex-col gap-3">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="h-12 rounded-lg border border-zinc-300 bg-transparent px-4 text-base focus-visible:outline-2 focus-visible:outline-emerald-700 dark:border-zinc-700"
        />
        <button type="submit" className={PRIMARY_BUTTON}>
          {submitLabel}
        </button>
      </form>

      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 text-sm text-zinc-500">
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            or
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </div>
          <form action={signInWithGoogle}>
            <button type="submit" className={SECONDARY_BUTTON}>
              Continue with Google
            </button>
          </form>
        </>
      )}
    </div>
  );
}
