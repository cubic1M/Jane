import { NextResponse } from "next/server";
import { limitOrNull } from "@/lib/rate-limit";
import { dismissOffer } from "@/lib/membership/service";
import { getCurrentUser } from "@/lib/session";

// "Not now": hides the offer for OFFER_SNOOZE_DAYS.
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const limited = await limitOrNull("membership", user.id);
  if (limited) return limited;
  await dismissOffer(user.id);
  return NextResponse.json({ dismissed: true });
}
