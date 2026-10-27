import { after, NextResponse } from "next/server";
import { TERMS_VERSION } from "@/config/legal";
import { IMPORT_HEADER } from "@/config/import";
import { moneyFound } from "@/detection/engine";
import { canImportCsv } from "@/lib/csv-access";
import { scopedFor } from "@/lib/db-scoped";
import {
  NOT_ALLOWED,
  detectAfterUpload,
  finishUpload,
  saveUpload,
  type UploadStage,
} from "@/lib/import/upload";
import { getCurrentUser } from "@/lib/session";

// Importing an upload from /import, with its progress (founder: "it's taking quite a while",
// wants a loading bar). The response streams one JSON object per line as each step starts:
// {"stage":"reading"}, {"stage":"sorting","rows":N}, {"stage":"saving"}, {"stage":"looking"},
// then {"type":"done","foundCents":X,"next":"/report"} once the findings are in, or
// {"type":"error","text":…}. Claude's sorting of unknown merchants, the card text and Jane's
// chat message run after that (finishUpload), and keep running if the page is left.

// Saving and looking for savings take seconds; this is room for a slow database.
export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (user.termsVersion !== TERMS_VERSION) {
    return NextResponse.json({ error: "Accept the Terms first" }, { status: 403 });
  }
  if (!canImportCsv(user)) return NextResponse.json({ error: NOT_ALLOWED }, { status: 403 });
  // Only the page's own script sets this header; a form on another site can't.
  if (request.headers.get(IMPORT_HEADER) !== "1") {
    return NextResponse.json({ error: "Upload from the import page" }, { status: 400 });
  }
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Send the upload form" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      // The page was left: the import carries on, with nobody to tell.
      controller = null;
    },
  });
  const send = (line: UploadStage | { stage: "looking" } | Record<string, unknown>) => {
    try {
      controller?.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
    } catch {
      controller = null;
    }
  };
  const close = () => {
    try {
      controller?.close();
    } catch {
      // Already closed by the page leaving.
    }
    controller = null;
  };

  const userId = user.id;
  const work = (async () => {
    try {
      const result = await saveUpload(scopedFor(userId), formData, { onStage: send });
      if (!result.ok) {
        send({ type: "error", text: result.error });
        return;
      }
      send({ stage: "looking" });
      await detectAfterUpload(userId);
      send({ type: "done", foundCents: await moneyFound(userId), next: "/report" });
      close();
      await finishUpload(userId, result.jobId);
    } catch (error) {
      console.error("Import failed", { error: error instanceof Error ? error.name : "unknown" });
      send({ type: "error", text: "Something went wrong saving your upload. Try again." });
    } finally {
      close();
    }
  })();
  // The work goes on after the response ends (or the page is left), until it's done.
  after(work);

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
