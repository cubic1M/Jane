import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", email: "alex@example.com" })),
}));
vi.mock("@/lib/rate-limit", () => ({ hit: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/documents/store", () => ({
  addDocument: vi.fn(),
  saveDocumentFacts: vi.fn(),
  removeDocument: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { MAX_DOCUMENT_BYTES } from "@/config/documents";
import { track } from "@/lib/analytics";
import { addDocument, removeDocument, saveDocumentFacts } from "@/lib/documents/store";
import { hit } from "@/lib/rate-limit";
import { deleteDocument, saveFacts, uploadDocument } from "./actions";

const PDF = "%PDF-1.7\n";

function uploadForm(
  kind = "insurance_policy",
  file: File | null = new File([PDF], "p.pdf", { type: "application/pdf" }),
) {
  const form = new FormData();
  form.set("kind", kind);
  if (file) form.set("file", file);
  return form;
}

describe("document actions (spec step 68)", () => {
  beforeEach(() => {
    vi.mocked(hit).mockReset().mockResolvedValue({ ok: true, remaining: 1, retryAfterSeconds: 0 });
    vi.mocked(addDocument).mockReset();
    vi.mocked(track).mockReset();
    vi.mocked(revalidatePath).mockReset();
  });

  it("uploads the file for the signed-in person and says Jane read it", async () => {
    vi.mocked(addDocument).mockResolvedValue({
      ok: true,
      id: "d1",
      read: "claude",
      summaryRejected: false,
    });

    const state = await uploadDocument(null, uploadForm());

    expect(state).toEqual({
      ok: true,
      message: "Saved. Jane read the key facts below. Check them and fix anything that's off.",
    });
    const [userId, upload] = vi.mocked(addDocument).mock.calls[0];
    expect(userId).toBe("u1");
    expect(upload.kind).toBe("insurance_policy");
    expect(upload.file).toEqual({ name: "p.pdf", type: "application/pdf", size: PDF.length });
    expect(Buffer.from(upload.bytes).toString()).toBe(PDF);
    expect(hit).toHaveBeenCalledWith("documents", "u1");
    expect(track).toHaveBeenCalledWith("u1", "document_uploaded", {
      kind: "insurance_policy",
      read: "claude",
    });
    // The message stays on screen; the form refreshes the list itself.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("asks the person for the facts when Jane couldn't read them", async () => {
    vi.mocked(addDocument).mockResolvedValue({
      ok: true,
      id: "d1",
      read: "you",
      summaryRejected: false,
    });
    expect(await uploadDocument(null, uploadForm())).toEqual({
      ok: true,
      message: "Saved. Fill in the key facts below so Jane can use them.",
    });
    vi.mocked(addDocument).mockResolvedValue({
      ok: true,
      id: "d1",
      read: "claude",
      summaryRejected: true,
    });
    expect((await uploadDocument(null, uploadForm()))?.message).toContain("in your own words");
  });

  it("passes on why a file was refused", async () => {
    vi.mocked(addDocument).mockResolvedValue({
      ok: false,
      error: "Upload a PDF, JPEG, PNG or WebP file.",
    });
    expect(await uploadDocument(null, uploadForm())).toEqual({
      ok: false,
      message: "Upload a PDF, JPEG, PNG or WebP file.",
    });
    expect(track).not.toHaveBeenCalled();
  });

  it("checks the form before reading the file", async () => {
    expect(await uploadDocument(null, uploadForm("insurance_policy", null))).toEqual({
      ok: false,
      message: "Choose a file.",
    });
    expect(await uploadDocument(null, uploadForm("passport"))).toEqual({
      ok: false,
      message: "Pick what kind of document it is.",
    });
    const big = new File([new Uint8Array(MAX_DOCUMENT_BYTES + 1)], "big.pdf", {
      type: "application/pdf",
    });
    expect((await uploadDocument(null, uploadForm("receipt", big)))?.message).toContain(
      "larger than",
    );
    expect(addDocument).not.toHaveBeenCalled();
  });

  it("is rate limited", async () => {
    vi.mocked(hit).mockResolvedValue({ ok: false, remaining: 0, retryAfterSeconds: 60 });
    expect(await uploadDocument(null, uploadForm())).toMatchObject({ ok: false });
    expect(addDocument).not.toHaveBeenCalled();
  });

  it("saves the person's facts", async () => {
    vi.mocked(saveDocumentFacts).mockResolvedValue({ ok: true });
    const form = new FormData();
    form.set("documentId", "d1");
    form.set("provider", "GEICO");
    form.set("renewalDate", "2027-03-01");

    expect(await saveFacts(null, form)).toEqual({ ok: true, message: "Saved." });
    expect(saveDocumentFacts).toHaveBeenCalledWith("u1", "d1", {
      provider: "GEICO",
      renewalDate: "2027-03-01",
    });

    vi.mocked(saveDocumentFacts).mockResolvedValue({ ok: false, error: "Renews on: bad" });
    expect(await saveFacts(null, form)).toEqual({ ok: false, message: "Renews on: bad" });
  });

  it("deletes a document for the signed-in person", async () => {
    const form = new FormData();
    form.set("documentId", "d1");
    await deleteDocument(form);
    expect(removeDocument).toHaveBeenCalledWith("u1", "d1");
    expect(revalidatePath).toHaveBeenCalledWith("/documents");
  });
});
