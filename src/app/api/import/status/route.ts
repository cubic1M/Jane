import { NextResponse } from "next/server";
import { currentImportRun } from "@/lib/import/background";
import { getCurrentUser } from "@/lib/session";

// How the signed-in person's latest upload is getting on, for the progress chip on every page
// (src/components/import-chip.tsx): {"run": null} when there's nothing to show. Someone signed
// out gets that too, not a 401: the chip is on every page, /, /login and /goodbye included, and
// a 401 there was a console error on each visit (first-user walk after "Delete all my data").
export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json(
    { run: user ? await currentImportRun(user.id) : null },
    { headers: { "cache-control": "no-store" } },
  );
}
