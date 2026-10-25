import { NextResponse, after } from "next/server";
import { runAgentNow } from "@/lib/agent/run";
import { limitOrNull } from "@/lib/rate-limit";
import { recordDecision } from "@/lib/decisions";
import { getCurrentUser } from "@/lib/session";
import { decisionErrorResponse } from "./errors";

const ID_PATTERN = /^[a-z0-9]{1,40}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
// A compared option's id (spec step 76), or "keep" for keeping what they have.
const OPTION_PATTERN = /^[a-z0-9-]{1,60}$/i;

// Records a yes, no or do-it-yourself on a decision card. The card hash proves which
// version was shown.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const limited = await limitOrNull("decisions", user.id);
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { findingId, choice, cardHash, switchTo } = body ?? {};
  if (
    typeof findingId !== "string" ||
    !ID_PATTERN.test(findingId) ||
    (choice !== "yes" && choice !== "no" && choice !== "diy") ||
    typeof cardHash !== "string" ||
    !HASH_PATTERN.test(cardHash) ||
    (switchTo !== undefined && (typeof switchTo !== "string" || !OPTION_PATTERN.test(switchTo)))
  ) {
    return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
  }

  try {
    const result = await recordDecision(user.id, {
      findingId,
      choice,
      cardHash,
      ...(choice === "yes" && typeof switchTo === "string" ? { options: { switchTo } } : {}),
    });
    after(() => runAgentNow([result.agentJobId]));
    return NextResponse.json(
      // diy: a real account's yes, recorded as theirs to do (read-only mode).
      { decisionId: result.decisionId, actionId: result.actionId, diy: result.diy ?? false },
      { status: 201 },
    );
  } catch (error) {
    return decisionErrorResponse(error);
  }
}
