import { calendarFeed, userForCalendarToken } from "@/lib/calendar";
import { ipKey, limitOrNull } from "@/lib/rate-limit";

// The private money calendar feed. Calendar apps fetch it without signing in, so the
// secret in the link is the only key: a reset or turned-off link answers 404.
export async function GET(request: Request, { params }: RouteContext<"/api/calendar/[token]">) {
  const limited = await limitOrNull("calendar", ipKey(request.headers));
  if (limited) return limited;
  const token = (await params).token.replace(/\.ics$/, "");
  const userId = await userForCalendarToken(token);
  if (!userId) return new Response("Not found", { status: 404 });
  return new Response(await calendarFeed(userId), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="money-calendar.ics"',
      "cache-control": "private, max-age=900",
    },
  });
}
