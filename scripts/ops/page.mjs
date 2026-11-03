// To the phone, if a founder has set one up. Failing to page must not stop anything else.
export async function page(text) {
  const url = process.env.OPS_PAGE_URL;
  if (!url) return false;
  try {
    const response = await fetch(url, {
      method: "POST",
      body: text,
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
