import { NextResponse } from "next/server";
import { beforeTerms } from "@/lib/before-terms";
import { limitOrNull } from "@/lib/rate-limit";
import { markSuggestionDone, OutcomeError } from "@/lib/outcomes";
import { getCurrentUser } from "@/lib/session";

// The key as the page wrote it into the address; null when no suggestion's could read that way
// (escapes that don't decode, or a null character, which the database refuses).
function decodedKey(key: string): string | null {
  try {
    const decoded = decodeURIComponent(key);
    return decoded.includes("\u0000") ? null : decoded;
  } catch {
    return null;
  }
}

// "Mark done" on a suggestion the person handled themselves: on the verified savings record
// from today, and watched for their transactions to show it.
export async function POST(
  _request: Request,
  { params }: RouteContext<"/api/suggestions/[key]/done">,
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const unaccepted = beforeTerms(user);
  if (unaccepted) return unaccepted;
  const limited = await limitOrNull("decisions", user.id);
  if (limited) return limited;

  const key = decodedKey((await params).key);
  if (key === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const { status } = await markSuggestionDone(user.id, key.slice(0, 200));
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    if (error instanceof OutcomeError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
