// Bump TERMS_VERSION whenever the Terms or Privacy Policy change in a way people should
// agree to again; everyone accepts the new version once, on their next visit.
export const TERMS_VERSION = "2026-10-26";

// The pages show a "draft" banner until counsel has reviewed them and LEGAL_REVIEWED is
// set to "true".
export function legalReviewed(): boolean {
  return process.env.LEGAL_REVIEWED === "true";
}

export const COMPANY_NAME = "Financial Controller";

// Where people write to us: SUPPORT_EMAIL, else the first founder address in ADMIN_EMAILS,
// else a placeholder that says plainly one is still to be set.
export const CONTACT_PLACEHOLDER = "[contact email to be added: set SUPPORT_EMAIL]";

export function contactEmail(env: Record<string, string | undefined> = process.env): string {
  const admin = (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .find((e) => e.includes("@"));
  return env.SUPPORT_EMAIL?.trim() || admin || CONTACT_PLACEHOLDER;
}
