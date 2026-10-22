import { NextResponse } from "next/server";
import { exportFamilyFile } from "@/lib/investments/family-file";
import { getCurrentUser } from "@/lib/session";

// The family file as text (spec step 237): the signed-in person's own file, only the
// sections they picked. Nothing is sent anywhere; they copy or save it themselves.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const text = await exportFamilyFile(user.id);
  return new NextResponse(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="what-my-family-would-need.txt"',
      "Cache-Control": "private, no-store",
    },
  });
}
