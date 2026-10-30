// A statement's bytes as text: UTF-8 (its byte-order mark dropped), else Windows-1252, as Excel on
// Windows and many credit unions save it (round 4: a file with "CAFÉ MÜNCHEN" in Latin-1 was
// refused as "not a CSV statement").
export function decodeStatement(bytes: ArrayBuffer | Uint8Array): string {
  // UTF-16, by its byte-order mark: Excel's "Unicode Text" save (night QA 10-30: refused as "not a
  // CSV statement").
  const head = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (head[0] === 0xff && head[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (head[0] === 0xfe && head[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
