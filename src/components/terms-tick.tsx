import Link from "next/link";

// "I agree to the Terms and Privacy Policy", for the ways of trying Jane on the landing page, in
// that page's own colours (src/app/landing.css).
export function TermsTick() {
  return (
    <label className="flex items-start gap-2 text-sm text-[var(--landing-mid)]">
      <input
        type="checkbox"
        name="consent"
        required
        className="mt-0.5 h-5 w-5 accent-[var(--landing-hi)]"
      />
      <span>
        I agree to the{" "}
        <Link
          href="/terms"
          className="font-medium text-[var(--landing-hi)] underline underline-offset-2 hover:no-underline"
        >
          Terms
        </Link>{" "}
        and{" "}
        <Link
          href="/privacy"
          className="font-medium text-[var(--landing-hi)] underline underline-offset-2 hover:no-underline"
        >
          Privacy Policy
        </Link>
        .
      </span>
    </label>
  );
}
