import { NextResponse } from "next/server";
import { limitOrNull } from "@/lib/rate-limit";
import { markDiyDone } from "@/lib/decisions";
import { getCurrentUser } from "@/lib/session";
import { decisionErrorResponse } from "../../errors";

// "I did it" on a do-it-yourself decision.
export async function POST(
  _request: Request,
  { params }: RouteContext<"/api/decisions/[decisionId]/diy-done">,
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const limited = await limitOrNull("decisions", user.id);
  if (limited) return limited;

  const { decisionId } = await params;
  try {
    await markDiyDone(user.id, decisionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return decisionErrorResponse(error);
  }
}
