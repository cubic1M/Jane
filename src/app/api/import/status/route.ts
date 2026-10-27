import { NextResponse } from "next/server";
import { currentImportRun } from "@/lib/import/background";
import { getCurrentUser } from "@/lib/session";

// How the signed-in person's latest upload is getting on, for the progress chip on every page
// (src/components/import-chip.tsx): {"run": null} when there's nothing to show.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json(
    { run: await currentImportRun(user.id) },
    { headers: { "cache-control": "no-store" } },
  );
}
