import { NextResponse } from "next/server";
import { PICK_UNDO_HOURS } from "@/config/rules";
import { undoDecision } from "@/lib/decisions";
import { limitOrNull } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";
import { undoApproval } from "@/lib/standing-rules";
import { decisionErrorResponse } from "../../errors";

// Revert on a card's answer (founder, 2026-10-25: "there should be a revert button"): a No is
// taken back within its undo window, a Yes while the work hasn't started (PICK_UNDO_HOURS); the
// finding goes back on the report either way.
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/decisions/[decisionId]/revert">,
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const limited = await limitOrNull("decisions", user.id);
  if (limited) return limited;

  const { decisionId } = await params;
  const body = (await request.json().catch(() => null)) as { choice?: unknown } | null;
  const choice = body?.choice;
  if (choice !== "yes" && choice !== "no") {
    return NextResponse.json({ error: "Say which answer to take back." }, { status: 400 });
  }
  try {
    if (choice === "no") await undoDecision(user.id, decisionId);
    else await undoApproval(user.id, decisionId, "card", PICK_UNDO_HOURS);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return decisionErrorResponse(error);
  }
}
