// Google sign-in is optional until its OAuth client is set up (docs/setup/google-sign-in.md):
// both halves must be set, or the provider isn't registered and the button doesn't show.
export function googleConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.AUTH_GOOGLE_ID?.trim() && env.AUTH_GOOGLE_SECRET?.trim());
}
