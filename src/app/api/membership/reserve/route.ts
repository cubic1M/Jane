import { NextResponse } from "next/server";
import { reserveMembership } from "@/lib/membership/service";
import { getCurrentUser } from "@/lib/session";

// "Reserve my spot": free, records interest in membership.
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  await reserveMembership(user.id);
  return NextResponse.json({ reserved: true });
}
