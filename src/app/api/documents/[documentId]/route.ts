import { NextResponse, type NextRequest } from "next/server";
import { openDocument } from "@/lib/documents/store";
import { DOCUMENT_FILE_CSP } from "@/lib/security-headers";
import { getCurrentUser } from "@/lib/session";

// One uploaded document, decrypted, for its owner only (spec step 68). Anyone else gets
// the same 404 as a missing id, so ids can't be probed. Images open in the browser,
// sandboxed; PDFs always download, because Chrome won't show a PDF in a sandboxed
// document. ?download=1 saves an image too.

// The name for the download header: plain ASCII for old browsers, the real name encoded.
function disposition(type: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(
  request: NextRequest,
  { params }: RouteContext<"/api/documents/[documentId]">,
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { documentId } = await params;
  const file = await openDocument(user.id, documentId);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const download =
    file.contentType === "application/pdf" || request.nextUrl.searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "content-type": file.contentType,
      "content-length": String(file.bytes.length),
      "content-disposition": disposition(download ? "attachment" : "inline", file.fileName),
      "x-content-type-options": "nosniff",
      // A crafted image opened inline can't run script on Jane's origin.
      "content-security-policy": DOCUMENT_FILE_CSP,
      "cache-control": "private, no-store",
    },
  });
}
