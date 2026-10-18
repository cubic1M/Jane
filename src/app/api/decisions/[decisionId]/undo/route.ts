import { NextResponse } from "next/server";
import { undoDecision } from "@/lib/decisions";
import { getCurrentUser } from "@/lib/session";
import { decisionErrorResponse } from "../../errors";

// Takes back a "no" within the undo window; the finding goes back on the report.
export async function POST(
  _request: Request,
  { params }: RouteContext<"/api/decisions/[decisionId]/undo">,
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { decisionId } = await params;
  try {
    await undoDecision(user.id, decisionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return decisionErrorResponse(error);
  }
}
