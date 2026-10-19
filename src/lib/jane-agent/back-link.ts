// Spec step 86: the pages are the chat's details. A page opened from one of Jane's messages
// carries the message's id (?from=…), so it can link back to that message in the chat
// (/chat#<id>, the anchor notifications use too).

export const FROM_PARAM = "from";

const MESSAGE_ID = /^[a-z0-9]{1,40}$/i;

// The link with the message's id added, for the app's own pages only (not the chat itself,
// nor a company's site).
export function withFrom(href: string, messageId: string): string {
  if (!href.startsWith("/") || href.startsWith("//") || !MESSAGE_ID.test(messageId)) return href;
  const [path, hash] = href.split("#", 2);
  if (path === "/chat" || path.startsWith("/chat?") || path.startsWith("/chat/")) return href;
  const joined = `${path}${path.includes("?") ? "&" : "?"}${FROM_PARAM}=${messageId}`;
  return hash === undefined ? joined : `${joined}#${hash}`;
}

// Where "Back to the chat" goes: the message, when the id looks like one.
export function chatMessageHref(messageId: string | null | undefined): string | null {
  return messageId && MESSAGE_ID.test(messageId) ? `/chat#${messageId}` : null;
}
