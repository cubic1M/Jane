// Bump TERMS_VERSION whenever the Terms or Privacy Policy change in a way people should
// agree to again; everyone accepts the new version once, on their next visit.
export const TERMS_VERSION = "2026-10-25";

// The pages show a "draft" banner until counsel has reviewed them and LEGAL_REVIEWED is
// set to "true".
export function legalReviewed(): boolean {
  return process.env.LEGAL_REVIEWED === "true";
}

export const COMPANY_NAME = "Financial Controller";

// Where people write to us: SUPPORT_EMAIL, else the address in EMAIL_FROM.
export function contactEmail(): string {
  const from = process.env.EMAIL_FROM ?? "";
  return (
    process.env.SUPPORT_EMAIL ||
    from.match(/<([^>]+)>/)?.[1] ||
    from ||
    "the email address we write to you from"
  );
}
