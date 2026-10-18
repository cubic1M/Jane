import { NextResponse } from "next/server";
import { DecisionError, type DecisionErrorCode } from "@/lib/decisions";

const STATUS: Record<DecisionErrorCode, number> = {
  not_found: 404,
  already_decided: 409,
  card_changed: 409,
  cannot_undo: 409,
  no_kit: 409,
};

// A DecisionError as a JSON response the page can show; anything else is rethrown.
export function decisionErrorResponse(error: unknown): NextResponse {
  if (!(error instanceof DecisionError)) throw error;
  return NextResponse.json(
    { error: error.message, code: error.code },
    { status: STATUS[error.code] },
  );
}
