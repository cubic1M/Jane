import { NextResponse } from "next/server";
import { TERMS_VERSION } from "@/config/legal";

// For a route that acts for a person: the answer while they haven't accepted the current Terms, null
// once they have. A direct call isn't past the Terms just because the page would have been.
export function beforeTerms(user: { termsVersion?: string | null }): NextResponse | null {
  if (user.termsVersion === TERMS_VERSION) return null;
  return NextResponse.json({ error: "Accept the Terms first." }, { status: 403 });
}
