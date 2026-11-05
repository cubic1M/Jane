// A browser saying this came from another site. Older browsers send nothing, and the session cookie
// (SameSite=Lax) is still what stops a form posted from elsewhere. A link from elsewhere does carry
// that cookie, so a route a link can set off has to ask.
export function fromAnotherSite(request: Request): boolean {
  const from = request.headers.get("sec-fetch-site");
  return Boolean(from) && from !== "same-origin" && from !== "none";
}
