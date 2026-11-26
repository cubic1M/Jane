import { NextResponse } from "next/server";
import { track } from "@/lib/analytics";
import { db } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { landingPath } from "@/lib/digest/links";
import { log } from "@/lib/log";
import { systemDb } from "@/lib/system-db";

const ID_PATTERN = /^[a-z0-9]{1,40}$/i;

// A click on a digest link: records the first open (we don't use tracking pixels) and
// redirects to the page with UTM parameters. Unknown links still land on the report.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const digestId = url.searchParams.get("d") ?? "";
  const to = url.searchParams.get("to");
  const destination = new URL(landingPath(to), url.origin);

  if (ID_PATTERN.test(digestId)) {
    // Counting the open never keeps the reader from the page they asked for.
    await noteOpened(digestId, destination.pathname).catch((error) =>
      log.error("Couldn't note a digest click", { error: String(error) }),
    );
  }
  return NextResponse.redirect(destination, 303);
}

async function noteOpened(digestId: string, to: string) {
  // Finds the digest's owner; the update below is scoped to them.
  const digest = await systemDb(
    "An emailed link: the digest's id is the key, nobody is signed in",
  ).digest.findUnique({
    where: { id: digestId },
    select: { id: true, userId: true },
  });
  if (!digest) return;
  await scopedFor(digest.userId).digests.updateMany({
    where: { id: digest.id, openedAt: null },
    data: { openedAt: new Date() },
  });
  await track(digest.userId, "digest_clicked", { to });
}
