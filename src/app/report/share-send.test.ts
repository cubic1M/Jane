import { describe, expect, it, vi } from "vitest";
import { sendLink, usesShareSheet } from "./share-send";

const URL_ = "https://jane.test/join/ABCD-EFGH-JKMN";
const TEXT = "Jane found me $1,200/yr";

function browser({ share, write }: { share?: () => Promise<void>; write?: () => Promise<void> }) {
  return {
    share: share ? vi.fn(share) : undefined,
    clipboard: { writeText: vi.fn(write ?? (async () => {})) },
  };
}

describe("usesShareSheet", () => {
  it("is the share sheet on a phone, copy on a computer", () => {
    const share = async () => {};
    expect(usesShareSheet({ share }, true)).toBe(true);
    expect(usesShareSheet({ share }, false)).toBe(false);
    expect(usesShareSheet({}, true)).toBe(false);
  });
});

describe("sendLink", () => {
  it("opens the share sheet with the card's line and the link", async () => {
    const b = browser({ share: async () => {} });
    expect(await sendLink(b, { url: URL_, text: TEXT, sheet: true })).toEqual({
      sent: "share_sheet",
      note: "Shared.",
    });
    expect(b.share).toHaveBeenCalledWith({ title: "Jane", text: TEXT, url: URL_ });
    expect(b.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("counts nothing when the sheet is closed", async () => {
    const abort = Object.assign(new Error("closed"), { name: "AbortError" });
    const b = browser({ share: async () => Promise.reject(abort) });
    expect(await sendLink(b, { url: URL_, text: TEXT, sheet: true })).toEqual({
      sent: null,
      note: null,
    });
    expect(b.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("copies when the sheet fails for another reason", async () => {
    const b = browser({ share: async () => Promise.reject(new Error("NotAllowedError")) });
    expect((await sendLink(b, { url: URL_, text: TEXT, sheet: true })).sent).toBe("copy");
    expect(b.clipboard.writeText).toHaveBeenCalledWith(URL_);
  });

  it("copies the link on a computer", async () => {
    const b = browser({ share: async () => {} });
    expect(await sendLink(b, { url: URL_, text: TEXT, sheet: false })).toEqual({
      sent: "copy",
      note: "Link copied. Paste it to a friend.",
    });
    expect(b.share).not.toHaveBeenCalled();
  });

  it("shows the link to select when copying isn't allowed, and counts nothing", async () => {
    const b = browser({ write: async () => Promise.reject(new Error("denied")) });
    expect(await sendLink(b, { url: URL_, text: TEXT, sheet: false })).toEqual({
      sent: null,
      note: `Copy your link: ${URL_}`,
    });
  });
});
