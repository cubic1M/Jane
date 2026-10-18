import {
  DOCUMENT_TYPES,
  MAX_DOCUMENTS,
  MAX_DOCUMENT_BYTES,
  MAX_FILE_NAME_LENGTH,
  type DocumentContentType,
} from "@/config/documents";

// Which uploads we keep (spec step 68). Pure: the caller reads the file into memory first.

const startsWith = (bytes: Uint8Array, prefix: number[], offset = 0) =>
  bytes.length >= offset + prefix.length && prefix.every((b, i) => bytes[offset + i] === b);

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

// The type a file really is, from its first bytes, or null for anything we don't keep.
export function sniffType(bytes: Uint8Array): DocumentContentType | null {
  if (startsWith(bytes, ascii("%PDF-"))) return "application/pdf";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  return null;
}

// The browser's word for the file's type, with the one common alias.
function statedType(type: string): DocumentContentType | null {
  const clean = type.trim().toLowerCase();
  const named = clean === "image/jpg" ? "image/jpeg" : clean;
  return named in DOCUMENT_TYPES ? (named as DocumentContentType) : null;
}

// A file name that is safe to show and to put in a download header: no folders, no control
// characters, no quotes, and not too long.
export function cleanFileName(name: string, contentType: DocumentContentType): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FILE_NAME_LENGTH);
  return clean || `document.${DOCUMENT_TYPES[contentType].extension}`;
}

export type UploadFile = { name: string; type: string; size: number };

export type UploadCheck =
  { ok: true; contentType: DocumentContentType; fileName: string } | { ok: false; error: string };

const TYPES_TEXT = "a PDF, JPEG, PNG or WebP file";

export function checkUpload(file: UploadFile, bytes: Uint8Array, kept: number): UploadCheck {
  if (kept >= MAX_DOCUMENTS) {
    return {
      ok: false,
      error: `You can keep up to ${MAX_DOCUMENTS} files. Delete one to add another.`,
    };
  }
  if (file.size === 0 || bytes.length === 0) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_DOCUMENT_BYTES || bytes.length > MAX_DOCUMENT_BYTES) {
    return {
      ok: false,
      error: `That file is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB. Try a smaller scan or a photo.`,
    };
  }
  const stated = statedType(file.type);
  const actual = sniffType(bytes);
  if (!stated || !actual || stated !== actual) {
    return { ok: false, error: `Upload ${TYPES_TEXT}.` };
  }
  return { ok: true, contentType: actual, fileName: cleanFileName(file.name, actual) };
}
