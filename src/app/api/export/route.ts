import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { exportUserData } from "@/lib/data-export";
import { limitOrNull } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";
import { localDate } from "@/lib/today";

// "Download my data" from /settings: a JSON file of everything we hold about the person.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const limited = await limitOrNull("export", user.id);
  if (limited) return limited;

  const data = await exportUserData(user.id);
  await logAudit(
    { type: "user", id: user.id },
    "data_exported",
    { type: "user", id: user.id },
    {
      transactions: data.transactions.length,
    },
  );
  // The person's own day, not UTC's: at 9:54pm in Los Angeles the file said tomorrow.
  const day = localDate(new Date(data.exportedAt), data.profile?.timezone);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="jane-data-${day}.json"`,
      "cache-control": "no-store",
    },
  });
}
