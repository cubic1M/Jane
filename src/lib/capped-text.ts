// Reads a request's or an answer's body up to the limit in bytes, or null past it: a huge one can't
// fill the memory.
export async function cappedText(
  from: { body: ReadableStream<Uint8Array> | null },
  limit: number,
): Promise<string | null> {
  const reader = from.body?.getReader();
  if (!reader) return "";
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(parts));
}
