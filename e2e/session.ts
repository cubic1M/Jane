import type { BrowserContext } from "@playwright/test";

// Signs a browser in as a test person: their session cookie on the app's address (e2e/db.ts
// signedInUser makes the person and the token).
export function signInWith(
  context: BrowserContext,
  sessionToken: string,
  baseURL: string | undefined,
): Promise<void> {
  return context.addCookies([
    { name: "authjs.session-token", value: sessionToken, url: baseURL ?? "" },
  ]);
}
