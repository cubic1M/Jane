import { NextResponse } from "next/server";
import { recordDecision } from "@/lib/decisions";
import { getCurrentUser } from "@/lib/session";
import { decisionErrorResponse } from "./errors";

const ID_PATTERN = /^[a-z0-9]{1,40}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

// Records a yes or no on a decision card. The card hash proves which version was shown.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { findingId, choice, cardHash } = body ?? {};
  if (
    typeof findingId !== "string" ||
    !ID_PATTERN.test(findingId) ||
    (choice !== "yes" && choice !== "no") ||
    typeof cardHash !== "string" ||
    !HASH_PATTERN.test(cardHash)
  ) {
    return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
  }

  try {
    const result = await recordDecision(user.id, { findingId, choice, cardHash });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return decisionErrorResponse(error);
  }
}
