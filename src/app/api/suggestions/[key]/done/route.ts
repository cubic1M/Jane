import { NextResponse } from "next/server";
import { limitOrNull } from "@/lib/rate-limit";
import { markSuggestionDone, OutcomeError } from "@/lib/outcomes";
import { getCurrentUser } from "@/lib/session";

// "Mark done" on a suggestion the person handled themselves: on the verified savings record
// from today, and watched for their transactions to show it.
export async function POST(
  _request: Request,
  { params }: RouteContext<"/api/suggestions/[key]/done">,
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const limited = await limitOrNull("decisions", user.id);
  if (limited) return limited;

  const { key } = await params;
  try {
    const { status } = await markSuggestionDone(user.id, decodeURIComponent(key).slice(0, 200));
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    if (error instanceof OutcomeError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
