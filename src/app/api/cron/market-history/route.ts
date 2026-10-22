import { NextResponse } from "next/server";
import { loadHistory, HistoryError } from "@/lib/market/history";
import { marketData } from "@/lib/market";

// The one-time market history load (spec step 289, Phase AW): pulls daily closes for the model
// portfolios' ETFs from Alpaca into our database. On the Vercel schedule once a day (vercel.json):
// the first run loads everything since HISTORY_START, later runs only add the new days (rows
// already stored are skipped). Needs ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY; with
// neither set it refuses, and the sample market stays in use. Alpaca is only read from: no
// order is ever placed.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ loaded: await loadHistory(marketData()) });
  } catch (error) {
    if (error instanceof HistoryError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Market history load failed", { error: String(error) });
    return NextResponse.json({ error: "The load failed; see the logs." }, { status: 500 });
  }
}
