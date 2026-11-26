import { NextResponse } from "next/server";
import { fromAnotherSite } from "@/lib/from-another-site";
import { exportFamilyFile } from "@/lib/investments/family-file";
import { getCurrentUser } from "@/lib/session";

// The family file as text (spec step 237): the signed-in person's own file, only the
// sections they picked. Nothing is sent anywhere; they copy or save it themselves. Not from another
// site's link, which would drop it in their downloads on whatever computer they're at.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (fromAnotherSite(request)) {
    return NextResponse.redirect(new URL("/investments/family-file", request.url), 303);
  }
  const text = await exportFamilyFile(user.id);
  return new NextResponse(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="what-my-family-would-need.txt"',
      "Cache-Control": "private, no-store",
    },
  });
}
