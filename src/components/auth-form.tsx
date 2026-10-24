import Link from "next/link";
import { googleEnabled } from "@/auth";
import { signInWithEmail, signInWithGoogle } from "@/lib/auth-actions";
import { invitesRequired } from "@/lib/invites";

const PRIMARY_BUTTON =
  "inline-flex h-12 items-center justify-center rounded-full bg-emerald-700 px-8 text-base font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700";

const SECONDARY_BUTTON =
  "inline-flex h-12 w-full items-center justify-center rounded-full border border-zinc-300 px-8 text-base font-semibold transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 dark:border-zinc-700 dark:hover:bg-zinc-900";

const FIELD =
  "h-12 rounded-lg border border-zinc-300 bg-transparent px-4 text-base focus-visible:outline-2 focus-visible:outline-emerald-700 dark:border-zinc-700";

// One form for both ways in, so the invite code (on /signup) goes with either button.
// On /signup (signUp) it also asks for an invite code (during the closed beta) and
// agreement to the Terms.
export function AuthForm({
  submitLabel,
  signUp = false,
}: {
  submitLabel: string;
  signUp?: boolean;
}) {
  const invite = signUp && invitesRequired();
  return (
    <form action={signInWithEmail} className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {invite && (
          <>
            <label htmlFor="invite" className="text-sm font-medium">
              Invite code
            </label>
            <input
              id="invite"
              name="invite"
              required
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="ABCD-EFGH-JKMN"
              className={`${FIELD} uppercase`}
            />
          </>
        )}
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
          className={FIELD}
        />
        {signUp && (
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="consent" required className="mt-0.5 h-5 w-5" />
            <span>
              I agree to the{" "}
              <Link href="/terms" className="font-medium text-emerald-700 hover:underline">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="font-medium text-emerald-700 hover:underline">
                Privacy Policy
              </Link>
              .
            </span>
          </label>
        )}
        <button type="submit" className={PRIMARY_BUTTON}>
          {submitLabel}
        </button>
      </div>

      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 text-sm text-zinc-500">
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            or
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </div>
          {/* Skips the email field's "required"; the invite code is still checked. */}
          <button
            type="submit"
            formAction={signInWithGoogle}
            formNoValidate
            className={SECONDARY_BUTTON}
          >
            Continue with Google
          </button>
        </>
      )}
    </form>
  );
}
