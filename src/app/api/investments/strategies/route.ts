import { NextResponse } from "next/server";
import { RISK_LEVELS, type RiskLevel } from "@/config/investing";
import { adviceMode } from "@/lib/advice-mode";
import { strategyBoardFor } from "@/lib/investments/strategy-board-load";
import { getCurrentUser } from "@/lib/session";

// One risk level's strategies for the investments page's tree (src/lib/investments/
// strategy-board.ts), fetched when the person opens a level that isn't their own, so the page
// carries one level's curves, not five. From the stored research only; demo advice only.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!(await adviceMode(user.id)))
    return NextResponse.json({ error: "Demo advice only" }, { status: 403 });
  const level = Number(new URL(request.url).searchParams.get("level"));
  if (!Object.hasOwn(RISK_LEVELS, level))
    return NextResponse.json({ error: "level must be 1 to 5" }, { status: 400 });
  return NextResponse.json(await strategyBoardFor(user.id, level as RiskLevel), {
    headers: { "cache-control": "private, no-store" },
  });
}
