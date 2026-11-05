// Reads a body up to the limit, or null past it: a huge answer can't fill the memory.
export async function cappedText(response: Response, limit: number): Promise<string | null> {
  const reader = response.body?.getReader();
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
  return Buffer.concat(parts).toString("utf8");
}
