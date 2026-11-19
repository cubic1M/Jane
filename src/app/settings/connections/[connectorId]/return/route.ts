import { NextResponse } from "next/server";
import { connectorsOn } from "@/config/connectors";
import { finishConnect, safeReturnPath } from "@/lib/connectors/connect";
import { getCurrentUser } from "@/lib/session";

// The way back from a partner's own step (src/lib/connectors/connect.ts): reads for the signed-in
// person if their consent still stands, then back to the card they came from. Only ever a path on Jane.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ connectorId: string }> },
) {
  if (!connectorsOn()) return new NextResponse(null, { status: 404 });
  const user = await getCurrentUser();
  const url = new URL(request.url);
  if (!user) return NextResponse.redirect(new URL("/login", url));
  const { connectorId } = await params;
  const read = await finishConnect(user.id, connectorId);
  const back = safeReturnPath(url.searchParams.get("from"));
  const done = new URL(back, url);
  if (read) done.searchParams.set("connected", connectorId);
  return NextResponse.redirect(done);
}
