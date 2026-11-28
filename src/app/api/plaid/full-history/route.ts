import { NextResponse, after } from "next/server";
import { categorizeLeftovers } from "@/categorize/categorize";
import { meteredClaude } from "@/lib/claude-budget";
import { scopedFor } from "@/lib/db-scoped";
import { log } from "@/lib/log";
import { beforeTerms } from "@/lib/before-terms";
import { limitOrNull } from "@/lib/rate-limit";
import { freshSwitches } from "@/lib/ops-switches";
import { PlaidRequestError, plaidEnabled } from "@/lib/plaid/client";
import { LinkingClosedError, linkClosedAnswer } from "@/lib/plaid/item-slots";
import { REPLACE_WORDS, ReplaceRefused, replaceWithFullHistory } from "@/lib/plaid/replace";
import { syncFromWebhook } from "@/lib/plaid/webhooks";
import { getCurrentUser } from "@/lib/session";
import { closeSettled } from "@/lib/jane-agent/messages";
import { scanSuggestions } from "@/lib/suggestions";

const ID_PATTERN = /^[a-z0-9]{1,40}$/i;

// The new link's history is waited for here (src/config/plaid.ts REPLACE_WAIT_MS), then moved in.
export const maxDuration = 300;

// "Get my full history": Link has made a new link of the same bank (asking for the longest history);
// this reads it, moves the person's accounts, transactions and everything they set onto it, and removes
// the old link. Anything short of that leaves the old link as it was. See src/lib/plaid/replace.ts.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const unaccepted = beforeTerms(user);
  if (unaccepted) return unaccepted;
  const limited = await limitOrNull("plaid", user.id);
  if (limited) return limited;
  await freshSwitches();
  if (!plaidEnabled()) {
    return NextResponse.json({ error: "Bank linking isn't set up yet." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as {
    publicToken?: unknown;
    itemId?: unknown;
    institutionName?: unknown;
  } | null;
  const { publicToken, itemId, institutionName } = body ?? {};
  if (typeof publicToken !== "string" || !publicToken.startsWith("public-")) {
    return NextResponse.json({ error: "Invalid public token" }, { status: 400 });
  }
  if (typeof itemId !== "string" || !ID_PATTERN.test(itemId)) {
    return NextResponse.json({ error: "Invalid item" }, { status: 400 });
  }
  try {
    const result = await replaceWithFullHistory(
      user.id,
      itemId,
      publicToken,
      typeof institutionName === "string" ? institutionName.slice(0, 100) : null,
    );
    // Everything derived (recurring payments, findings, the chart's past) is worked out again from the
    // new link, after the answer, one sync at a time.
    after(async () => {
      // The cards are worked out again from the imported history whether or not that sync succeeds.
      try {
        await syncFromWebhook(result.itemId);
      } catch (error) {
        log.error("Sync after getting the full history failed", { error: String(error) });
      }
      try {
        // Rows saved without a category (the move gave up waiting for Claude) are sorted now.
        await categorizeLeftovers(scopedFor(user.id), { claude: meteredClaude(user.id) });
      } catch (error) {
        log.error("Sorting the rest after getting the full history failed", {
          error: String(error),
        });
      }
      try {
        // The imported history is in whether or not that sync finds anything new: the day's cards are
        // worked out again from it, and the ones it settles are put away.
        await scanSuggestions(user.id);
        await closeSettled(user.id);
      } catch (error) {
        log.error("Sync after getting the full history failed", { error: String(error) });
      }
    });
    return NextResponse.json({ ok: true, transactions: result.twins + result.added });
  } catch (error) {
    if (error instanceof ReplaceRefused) {
      return NextResponse.json(
        { error: REPLACE_WORDS[error.reason] ?? "Nothing was changed." },
        { status: 409 },
      );
    }
    if (error instanceof LinkingClosedError) {
      return NextResponse.json(linkClosedAnswer(error.reason), { status: 409 });
    }
    if (error instanceof PlaidRequestError) {
      log.error("Plaid full history failed", { code: error.code });
      return NextResponse.json(
        { error: "Couldn't get the full history. Nothing was changed. Try again later." },
        { status: 502 },
      );
    }
    throw error;
  }
}
