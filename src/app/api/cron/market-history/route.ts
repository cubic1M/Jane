import { NextResponse } from "next/server";
import { loadHistory, HistoryError } from "@/lib/market/history";
import { marketData } from "@/lib/market";

// The one-time market history load (spec step 289, Phase AW): pulls daily closes for the model
// portfolios' ETFs from Alpaca into our database. On the Vercel schedule once a day (vercel.json):
// the first run loads everything since HISTORY_START, later runs only add the new days (rows
// already stored are skipped). Needs ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY; with
// neither set it refuses, and the sample market stays in use. Alpaca is only read from: no
// order is ever placed. History comes from the SIP feed (ALPACA_HISTORY_FEED, "sip" by default):
// the free plan serves it for bars older than 15 minutes, back to 2016, while the IEX feed's
// daily bars start in mid-2020. Live prices keep ALPACA_DATA_FEED.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const feed = process.env.ALPACA_HISTORY_FEED || "sip";
    return NextResponse.json({
      loaded: await loadHistory(marketData({ ...process.env, ALPACA_DATA_FEED: feed })),
    });
  } catch (error) {
    if (error instanceof HistoryError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Market history load failed", { error: String(error) });
    return NextResponse.json({ error: "The load failed; see the logs." }, { status: 500 });
  }
}
