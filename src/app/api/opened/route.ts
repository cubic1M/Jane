import { NextRequest, NextResponse, after } from "next/server";
import { log } from "@/lib/log";
import { pageOpened, type OpenedPage } from "@/lib/page-opened";
import { getCurrentUser } from "@/lib/session";

const PAGES: readonly OpenedPage[] = ["home", "investments", "plan"];
const ID_PATTERN = /^[a-z0-9_-]{1,64}$/i;
const MAX_IDS = 500;

// The browser says a page is really on screen (src/lib/page-opened.ts). Answered at once: the
// work runs after, and never fails the page. The ids are the person's own: markPlanShown scopes them.
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { page, findingIds = [] } = (body ?? {}) as { page?: unknown; findingIds?: unknown };
  if (!PAGES.includes(page as OpenedPage)) {
    return NextResponse.json({ error: "Unknown page" }, { status: 400 });
  }
  const validIds =
    Array.isArray(findingIds) &&
    findingIds.length <= MAX_IDS &&
    findingIds.every((id) => typeof id === "string" && ID_PATTERN.test(id));
  if (!validIds) return NextResponse.json({ error: "Invalid ids" }, { status: 400 });

  after(() =>
    pageOpened(user.id, page as OpenedPage, findingIds as string[]).catch((error) =>
      log.error("A page's opening work failed", {
        page: String(page),
        error: error instanceof Error ? error.name : "unknown",
      }),
    ),
  );
  return new NextResponse(null, { status: 204 });
}
