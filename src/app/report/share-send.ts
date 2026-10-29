import type { ShareMethod } from "@/lib/share-invites";

// Sending the share link: the phone's share sheet, or on a computer the link copied. Kept out
// of the button so each path is tested without a browser.

export type SendResult = { sent: ShareMethod; note: string } | { sent: null; note: string | null };

type Browser = {
  share?: (data: ShareData) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

// A phone: the share sheet. Computers copy the link, even where the browser has a share sheet.
export const usesShareSheet = (browser: Browser, coarsePointer: boolean) =>
  typeof browser.share === "function" && coarsePointer;

async function copy(browser: Browser, url: string): Promise<SendResult> {
  try {
    await browser.clipboard!.writeText(url);
    return { sent: "copy", note: "Link copied. Paste it to a friend." };
  } catch {
    // The link is still on screen to select.
    return { sent: null, note: `Copy your link: ${url}` };
  }
}

export async function sendLink(
  browser: Browser,
  { url, text, sheet }: { url: string; text: string; sheet: boolean },
): Promise<SendResult> {
  if (!sheet) return copy(browser, url);
  try {
    await browser.share!({ title: "Jane", text, url });
    return { sent: "share_sheet", note: "Shared." };
  } catch (error) {
    // Closing the sheet isn't a failure; anything else falls back to copying.
    if (error instanceof Error && error.name === "AbortError") return { sent: null, note: null };
    return copy(browser, url);
  }
}
