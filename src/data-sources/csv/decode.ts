// A statement's bytes as text: UTF-8 (its byte-order mark dropped), else Windows-1252, as Excel on
// Windows and many credit unions save it (round 4: a file with "CAFÉ MÜNCHEN" in Latin-1 was
// refused as "not a CSV statement").
export function decodeStatement(bytes: ArrayBuffer | Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
