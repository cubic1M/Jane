import { NextResponse } from "next/server";
import { track } from "@/lib/analytics";
import { db } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { landingPath } from "@/lib/digest/links";

const ID_PATTERN = /^[a-z0-9]{1,40}$/i;

// A click on a digest link: records the first open (we don't use tracking pixels) and
// redirects to the page with UTM parameters. Unknown links still land on the report.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const digestId = url.searchParams.get("d") ?? "";
  const to = url.searchParams.get("to");
  const destination = new URL(landingPath(to), url.origin);

  if (ID_PATTERN.test(digestId)) {
    // Finds the digest's owner; the update below is scoped to them.
    const digest = await db.digest.findUnique({
      where: { id: digestId },
      select: { id: true, userId: true },
    });
    if (digest) {
      await scopedFor(digest.userId).digests.updateMany({
        where: { id: digest.id, openedAt: null },
        data: { openedAt: new Date() },
      });
      await track(digest.userId, "digest_clicked", { to: destination.pathname });
    }
  }
  return NextResponse.redirect(destination, 303);
}
